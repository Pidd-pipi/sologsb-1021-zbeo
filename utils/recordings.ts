import type { DictionaryEntry } from '~/types/dictionary';
import { normalizeWord } from '~/utils/dictionary';

export interface RecordingRowInput {
  line: number;
  batch: string;
  form: string;
  dialect: string;
  speaker: string;
  fileName: string;
  duration: string;
}

export interface ParsedRecordingSheet {
  rows: RecordingRowInput[];
  errors: string[];
  hasHeader: boolean;
}

export type RecordingIssue =
  | 'missing-field'
  | 'missing-entry'
  | 'ambiguous-entry'
  | 'missing-dialect'
  | 'new-dialect'
  | 'duplicate-in-file'
  | 'duplicate-cross-batch';

export interface RecordingPreviewRow {
  input: RecordingRowInput;
  action: 'new' | 'update' | 'skip';
  issues: RecordingIssue[];
  notes: string[];
  entryId?: string;
  entryHeadword?: string;
  variantId?: string;
  createVariant?: boolean;
  existingRecordingId?: string;
  matchedVia?: string;
}

export interface RecordingImportResult {
  created: number;
  updated: number;
  variants: number;
  skipped: number;
}

type SheetField = 'batch' | 'form' | 'dialect' | 'speaker' | 'fileName' | 'duration';

const FIELD_ORDER: SheetField[] = ['batch', 'form', 'dialect', 'speaker', 'fileName', 'duration'];

const HEADER_ALIASES: Record<SheetField, string[]> = {
  batch: ['批次', '调查批次', 'batch'],
  form: ['词形', '词条', '词', 'headword', 'form'],
  dialect: ['方言', '方言点', 'dialect'],
  speaker: ['发音人', '说话人', 'speaker'],
  fileName: ['文件名', '录音号', '录音编号', '录音文件', 'file', 'filename'],
  duration: ['时长', '录音时长', 'duration']
};

const splitLine = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(/[,，]/)).map((cell) => cell.trim());

export const recordingKey = (batch: string, fileName: string) => `${batch.trim().toLowerCase()}::${fileName.trim().toLowerCase()}`;

export const parseRecordingText = (text: string, defaultBatch = ''): ParsedRecordingSheet => {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['没有可解析的内容，请粘贴录音清单'], hasHeader: false };

  const firstCells = splitLine(lines[0]!).map((cell) => cell.toLowerCase());
  const mapping = new Map<SheetField, number>();
  FIELD_ORDER.forEach((field) => {
    const index = firstCells.findIndex((cell) => HEADER_ALIASES[field].includes(cell));
    if (index >= 0) mapping.set(field, index);
  });
  const hasHeader = mapping.size >= 2;
  if (hasHeader && (!mapping.has('form') || !mapping.has('fileName'))) {
    errors.push('表头缺少「词形」或「文件名」列，相关行会被标记为字段缺失');
  }

  const rows: RecordingRowInput[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach((line, offset) => {
    const cells = splitLine(line);
    const read = (field: SheetField, position: number) => {
      if (hasHeader) {
        const index = mapping.get(field);
        return index === undefined ? '' : cells[index] ?? '';
      }
      return cells[position] ?? '';
    };
    rows.push({
      line: offset + (hasHeader ? 2 : 1),
      batch: read('batch', 0) || defaultBatch.trim(),
      form: read('form', 1),
      dialect: read('dialect', 2),
      speaker: read('speaker', 3),
      fileName: read('fileName', 4),
      duration: read('duration', 5)
    });
  });
  return { rows, errors, hasHeader };
};

interface ExistingRecording {
  entryId: string;
  headword: string;
  variantId: string;
  dialect: string;
  recordingId: string;
  batch: string;
}

export const buildRecordingPreview = (rows: RecordingRowInput[], entries: DictionaryEntry[]): RecordingPreviewRow[] => {
  const existingByKey = new Map<string, ExistingRecording>();
  const existingByFile = new Map<string, ExistingRecording[]>();
  entries.forEach((entry) => {
    entry.dialectVariants.forEach((variant) => {
      (variant.recordings ?? []).forEach((recording) => {
        const hit: ExistingRecording = {
          entryId: entry.id, headword: entry.headword, variantId: variant.id,
          dialect: variant.dialect, recordingId: recording.id, batch: recording.batch
        };
        existingByKey.set(recordingKey(recording.batch, recording.fileName), hit);
        const fileKey = recording.fileName.trim().toLowerCase();
        if (!existingByFile.has(fileKey)) existingByFile.set(fileKey, []);
        existingByFile.get(fileKey)!.push(hit);
      });
    });
  });

  const seenInFile = new Map<string, number>();

  return rows.map((input) => {
    const issues: RecordingIssue[] = [];
    const notes: string[] = [];
    const skip = (): RecordingPreviewRow => ({ input, action: 'skip', issues, notes });

    if (!input.batch || !input.form || !input.fileName) {
      issues.push('missing-field');
      notes.push('批次、词形和文件名为必填，该行无法导入');
      return skip();
    }

    const key = recordingKey(input.batch, input.fileName);
    const firstLine = seenInFile.get(key);
    if (firstLine !== undefined) {
      issues.push('duplicate-in-file');
      notes.push(`与第 ${firstLine} 行录音号重复，本行忽略`);
      return skip();
    }
    seenInFile.set(key, input.line);

    const existing = existingByKey.get(key);
    if (existing) {
      notes.push(`批次内已存在该录音号，将更新词条《${existing.headword}》/ ${existing.dialect} 下的原记录，不产生重复`);
      return {
        input, action: 'update', issues, notes,
        entryId: existing.entryId, entryHeadword: existing.headword,
        variantId: existing.variantId, existingRecordingId: existing.recordingId
      };
    }

    const formNorm = normalizeWord(input.form);
    const matches = new Map<string, { headword: string; via: string }>();
    entries.forEach((entry) => {
      if (normalizeWord(entry.headword) === formNorm) matches.set(entry.id, { headword: entry.headword, via: '词形' });
      else if (entry.dialectVariants.some((variant) => variant.form && normalizeWord(variant.form) === formNorm)) matches.set(entry.id, { headword: entry.headword, via: '方言变体' });
      else if (entry.synonyms.some((synonym) => normalizeWord(synonym) === formNorm)) matches.set(entry.id, { headword: entry.headword, via: '同义词' });
    });

    if (!matches.size) {
      issues.push('missing-entry');
      notes.push('词条库中找不到该词形，请先创建词条');
      return skip();
    }
    if (matches.size > 1) {
      issues.push('ambiguous-entry');
      notes.push(`同时匹配 ${[...matches.values()].map((match) => `《${match.headword}》`).join('、')}，请先查重合并`);
      return skip();
    }

    const [entryId, match] = [...matches.entries()][0]!;
    const entry = entries.find((item) => item.id === entryId)!;
    if (match.via !== '词形') notes.push(`通过${match.via}匹配到《${match.headword}》`);

    const dialectName = input.dialect.trim();
    if (!dialectName) {
      issues.push('missing-dialect');
      notes.push('未填写方言，无法挂到方言变体');
      return skip();
    }
    const variant = entry.dialectVariants.find((item) => item.dialect.trim().toLowerCase() === dialectName.toLowerCase());
    let variantId: string | undefined;
    let createVariant = false;
    if (variant) {
      variantId = variant.id;
    } else {
      createVariant = true;
      issues.push('new-dialect');
      notes.push(`词条暂无「${dialectName}」变体，导入时将自动新建`);
    }

    const crossBatch = (existingByFile.get(input.fileName.trim().toLowerCase()) ?? [])
      .filter((hit) => hit.batch.trim().toLowerCase() !== input.batch.trim().toLowerCase());
    if (crossBatch.length) {
      issues.push('duplicate-cross-batch');
      notes.push(`录音号已出现在批次 ${[...new Set(crossBatch.map((hit) => hit.batch))].join('、')}，导入后标记为待复核`);
    }

    return { input, action: 'new', issues, notes, entryId, entryHeadword: match.headword, variantId, createVariant, matchedVia: match.via };
  });
};
