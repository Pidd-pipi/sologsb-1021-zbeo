<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';
import { buildRecordingPreview, parseRecordingText } from '~/utils/recordings';
import type { RecordingImportResult, RecordingIssue, RecordingPreviewRow } from '~/utils/recordings';

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [result: RecordingImportResult] }>();
const store = useDictionaryStore();

const rawText = ref('');
const defaultBatch = ref('');
const parseErrors = ref<string[]>([]);
const preview = ref<RecordingPreviewRow[]>([]);
const previewed = ref(false);
const resultMessage = ref('');

const actionMeta = {
  new: { label: '新增', theme: 'success' },
  update: { label: '更新', theme: 'primary' },
  skip: { label: '跳过', theme: 'danger' }
} as const;

const issueLabels: Record<RecordingIssue, string> = {
  'missing-field': '字段缺失',
  'missing-entry': '缺少词条',
  'ambiguous-entry': '匹配多个词条',
  'missing-dialect': '缺少方言',
  'new-dialect': '将新建方言',
  'duplicate-in-file': '重复录音号',
  'duplicate-cross-batch': '跨批次重复'
};
const dangerIssues: RecordingIssue[] = ['missing-field', 'missing-entry', 'ambiguous-entry', 'missing-dialect', 'duplicate-in-file'];
const issueSeverity = (issue: RecordingIssue) => (dangerIssues.includes(issue) ? 'danger' : 'warning');

const actionableCount = computed(() => preview.value.filter((row) => row.action !== 'skip').length);
const counts = computed(() => ({
  total: preview.value.length,
  created: preview.value.filter((row) => row.action === 'new').length,
  updated: preview.value.filter((row) => row.action === 'update').length,
  newDialect: preview.value.filter((row) => row.issues.includes('new-dialect')).length,
  missingEntry: preview.value.filter((row) => row.issues.includes('missing-entry') || row.issues.includes('ambiguous-entry')).length,
  duplicate: preview.value.filter((row) => row.issues.includes('duplicate-in-file') || row.issues.includes('duplicate-cross-batch')).length,
  skipped: preview.value.filter((row) => row.action === 'skip').length
}));

const runPreview = () => {
  resultMessage.value = '';
  const parsed = parseRecordingText(rawText.value, defaultBatch.value);
  parseErrors.value = parsed.errors;
  preview.value = buildRecordingPreview(parsed.rows, store.entries);
  previewed.value = true;
};

const confirmImport = () => {
  const result = store.importRecordings(preview.value);
  if (!result) return;
  emit('imported', result);
  resultMessage.value = `已整批写入版本：新增 ${result.created} 条、更新 ${result.updated} 条录音`
    + `${result.variants ? `，新建 ${result.variants} 个方言变体` : ''}${result.skipped ? `，跳过 ${result.skipped} 行` : ''}。同一批次再次导入只会更新这些记录。`;
  rawText.value = '';
  preview.value = [];
  parseErrors.value = [];
  previewed.value = false;
};

const fillExample = () => {
  rawText.value = [
    '批次\t词形\t方言\t发音人\t文件名\t时长',
    '2025-09 嘎木村\tŋgɨ³³\t北坡话\t和秀英\tGM-2025-09-01\t00:03:12',
    '2025-09 嘎木村\tdʑa⁵⁵\t河西话\t王学明\tGM-2025-09-02\t00:04:05',
    '2025-09 嘎木村\tʔma³³\t河西话\t杨玉梅\tGM-2025-09-03\t00:01:57',
    '2025-09 嘎木村\ttsha⁵⁵\t北坡话\t和秀英\tGM-2025-09-04\t00:02:33',
    '2025-09 嘎木村\t未知词\t北坡话\t和秀英\tGM-2025-09-05\t00:02:10',
    '2025-09 嘎木村\tŋgɨ³³\t北坡话\t和秀英\tGM-2025-09-01\t00:03:12',
    '2018-04 嘎木村\tŋgɨ³³\t北坡话\t和秀英\tA-2018-04-17\t00:12:31'
  ].join('\n');
};

watch(visible, (open) => {
  if (!open) return;
  preview.value = [];
  parseErrors.value = [];
  resultMessage.value = '';
  previewed.value = false;
});
</script>

<template>
  <t-dialog v-model:visible="visible" header="录音核对与批次导入" width="1060px" :footer="false">
    <div class="recording-import">
      <div class="import-editor">
        <div class="import-editor-head">
          <div>
            <strong>粘贴录音清单</strong>
            <p>每行一条：批次、词形、方言、发音人、文件名、时长。支持从 Excel 直接粘贴（制表符）或逗号分隔，首行可带表头。</p>
          </div>
          <div class="import-editor-tools">
            <t-input v-model="defaultBatch" size="small" placeholder="默认批次（行内缺省时使用）" />
            <t-button size="small" variant="text" @click="fillExample">填入示例</t-button>
          </div>
        </div>
        <t-textarea v-model="rawText" :autosize="{ minRows: 5, maxRows: 9 }" placeholder="2025-09 嘎木村&#9;ŋgɨ³³&#9;北坡话&#9;和秀英&#9;GM-2025-09-01&#9;00:03:12" />
        <div class="import-run">
          <t-button theme="primary" variant="outline" :disabled="!rawText.trim()" @click="runPreview">解析并预览核对结果</t-button>
          <span v-for="error in parseErrors" :key="error" class="parse-error">{{ error }}</span>
        </div>
      </div>

      <template v-if="preview.length">
        <div class="preview-summary">
          <div><strong>{{ counts.total }}</strong><span>解析行</span></div>
          <div><strong>{{ counts.created }}</strong><span>新增录音</span></div>
          <div><strong>{{ counts.updated }}</strong><span>更新已有</span></div>
          <div class="warn"><strong>{{ counts.newDialect }}</strong><span>将新建方言</span></div>
          <div class="bad"><strong>{{ counts.missingEntry }}</strong><span>缺少词条</span></div>
          <div class="bad"><strong>{{ counts.duplicate }}</strong><span>重复录音号</span></div>
          <div class="bad"><strong>{{ counts.skipped }}</strong><span>跳过</span></div>
        </div>
        <div class="preview-scroll">
          <table class="preview-table">
            <thead>
              <tr><th>#</th><th>状态</th><th>批次</th><th>词形</th><th>方言</th><th>发音人</th><th>文件名</th><th>时长</th><th>核对说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in preview" :key="row.input.line" :class="{ muted: row.action === 'skip' }">
                <td class="num">{{ row.input.line }}</td>
                <td><t-tag size="small" variant="light" :theme="actionMeta[row.action].theme">{{ actionMeta[row.action].label }}</t-tag></td>
                <td>{{ row.input.batch || '—' }}</td>
                <td>{{ row.input.form || '—' }}</td>
                <td>{{ row.input.dialect || '—' }}</td>
                <td>{{ row.input.speaker || '—' }}</td>
                <td class="mono">{{ row.input.fileName || '—' }}</td>
                <td>{{ row.input.duration || '—' }}</td>
                <td>
                  <div class="note-line">
                    <span v-for="issue in row.issues" :key="issue" class="issue-pill" :class="issueSeverity(issue)">{{ issueLabels[issue] }}</span>
                    <span v-if="row.entryHeadword" class="match-target">→ {{ row.entryHeadword }}</span>
                  </div>
                  <p v-for="(note, index) in row.notes" :key="index">{{ note }}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <t-empty v-else-if="previewed" description="没有解析出有效行，请检查粘贴内容" />

      <t-alert v-if="resultMessage" theme="success" :title="resultMessage" class="import-result" />

      <div class="dialog-actions">
        <span class="import-hint">确认后整批写入一个版本，可撤销；同一批次再次导入只更新已核对条目，不产生重复。</span>
        <t-button variant="outline" @click="visible = false">关闭</t-button>
        <t-button theme="primary" :disabled="!actionableCount" @click="confirmImport">确认导入 {{ actionableCount }} 条录音</t-button>
      </div>
    </div>
  </t-dialog>
</template>
