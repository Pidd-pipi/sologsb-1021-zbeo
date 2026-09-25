import type { DictionaryEntry, RecordingPreviewRow, RecordingRow } from '~/types/dictionary';
import { normalizeWord } from '~/utils/dictionary';

const HEADER_HINTS = ['批次', '词形', '方言', '发音人', '文件名', '时长'];

const looksLikeHeader = (cells: string[]) => {
  const joined = cells.join(' ');
  return HEADER_HINTS.filter((hint) => joined.includes(hint)).length >= 2;
};

export const parseRecordingText = (text: string, defaultBatch = ''): RecordingRow[] => {
  const rows: RecordingRow[] = [];
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/[|｜]/)).map((cell) => cell.trim());
    if (!rows.length && looksLikeHeader(cells)) return;
    // 6 列：批次、词形、方言、发音人、文件名、时长；5 列时视为省略批次，使用统一批次
    const [batch, form, dialect, speaker, fileName, duration] = cells.length >= 6
      ? cells
      : ['', cells[0] ?? '', cells[1] ?? '', cells[2] ?? '', cells[3] ?? '', cells[4] ?? ''];
    rows.push({
      rowIndex: rows.length + 1,
      batch: batch || defaultBatch.trim(),
      form: form ?? '',
      dialect: dialect ?? '',
      speaker: speaker ?? '',
      fileName: fileName ?? '',
      duration: duration ?? ''
    });
  });
  return rows;
};

const findRecordingHolder = (entries: DictionaryEntry[], fileName: string) => {
  for (const entry of entries) {
    for (const variant of entry.dialectVariants) {
      const recording = (variant.recordings ?? []).find((item) => item.fileName === fileName);
      if (recording) return { entry, variant, recording };
    }
  }
  return null;
};

export const previewRecordingImport = (entries: DictionaryEntry[], rows: RecordingRow[]): RecordingPreviewRow[] => {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = { ...row };
    if (!row.fileName) return { ...base, match: 'invalid' as const, note: '缺少文件名（录音号），无法核对' };
    if (!row.form) return { ...base, match: 'invalid' as const, note: '缺少词形，无法匹配词条' };
    const firstRow = seen.get(row.fileName);
    if (firstRow !== undefined) {
      return { ...base, match: 'duplicate' as const, note: `与第 ${firstRow} 行的录音号重复，本行将跳过` };
    }
    seen.set(row.fileName, row.rowIndex);

    const normForm = normalizeWord(row.form);
    const entry = entries.find((item) => normalizeWord(item.headword) === normForm)
      ?? entries.find((item) => item.dialectVariants.some((variant) => variant.form && normalizeWord(variant.form) === normForm));
    if (!entry) {
      return { ...base, match: 'missing-entry' as const, note: `未找到词形为“${row.form}”的词条，本行将跳过` };
    }

    const holder = findRecordingHolder(entries, row.fileName);
    if (holder && holder.entry.id === entry.id) {
      return {
        ...base, match: 'update' as const,
        entryId: entry.id, entryHeadword: entry.headword,
        variantId: holder.variant.id, variantDialect: holder.variant.dialect,
        existingRecordingId: holder.recording.id,
        note: `词条“${entry.headword}”下已有该录音号，将更新核对信息，不产生重复`
      };
    }
    if (holder) {
      return {
        ...base, match: 'conflict' as const,
        entryId: entry.id, entryHeadword: entry.headword, conflictHeadword: holder.entry.headword,
        note: `录音号已挂在词条“${holder.entry.headword}”下，请人工核对后再导入`
      };
    }

    if (!row.dialect) {
      return { ...base, match: 'invalid' as const, entryId: entry.id, entryHeadword: entry.headword, note: '缺少方言，无法确定挂载的方言变体' };
    }
    const normDialect = normalizeWord(row.dialect);
    const variant = entry.dialectVariants.find((item) => normalizeWord(item.dialect) === normDialect);
    if (variant) {
      return {
        ...base, match: 'attach' as const,
        entryId: entry.id, entryHeadword: entry.headword,
        variantId: variant.id, variantDialect: variant.dialect,
        note: `匹配词条“${entry.headword}” · ${variant.dialect}`
      };
    }
    return {
      ...base, match: 'new-variant' as const,
      entryId: entry.id, entryHeadword: entry.headword,
      note: `词条“${entry.headword}”缺少“${row.dialect}”方言变体，导入时将自动创建`
    };
  });
};
