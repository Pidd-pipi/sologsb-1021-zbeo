<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';
import { parseRecordingText, previewRecordingImport } from '~/utils/recording';
import type { RecordingImportResult, RecordingMatchKind, RecordingPreviewRow } from '~/types/dictionary';

const visible = defineModel<boolean>({ required: true });
const store = useDictionaryStore();

const step = ref<'paste' | 'preview' | 'done'>('paste');
const rawText = ref('');
const defaultBatch = ref('');
const preview = ref<RecordingPreviewRow[]>([]);
const result = ref<RecordingImportResult | null>(null);

const SAMPLE = [
  'FW-2026-09\tŋgɨ³³\t北坡话\t和秀珍\tFW2026-09-001.wav\t00:01:18',
  'FW-2026-09\tŋgɨ³³\t河谷话\t和秀珍\tFW2026-09-002.wav\t00:00:54',
  'FW-2026-09\tdʑa⁵⁵\t东南村话\t阿吾\tFW2026-09-003.wav\t00:02:03',
  'FW-2026-09\tʔma³³\t河西话\t阿吾\tFW2026-09-004.wav\t00:00:47',
  'FW-2026-09\ttsha⁵⁵\t北坡话\t和秀珍\tFW2026-09-005.wav\t00:01:12',
  'FW-2026-09\tlo³³\t河谷话\t阿吾\tFW2026-09-005.wav\t00:00:58',
  'FW-2026-09\tʔdaŋ⁵⁵\t北坡话\t和秀珍\tFW2026-09-006.wav\t00:01:33'
].join('\n');

const matchMeta: Record<RecordingMatchKind, { label: string; theme: 'success' | 'primary' | 'warning' | 'danger' | 'default' }> = {
  attach: { label: '匹配词条', theme: 'success' },
  update: { label: '已核对·将更新', theme: 'primary' },
  'new-variant': { label: '新建方言变体', theme: 'warning' },
  'missing-entry': { label: '缺少词条', theme: 'danger' },
  conflict: { label: '录音号冲突', theme: 'danger' },
  duplicate: { label: '重复录音号', theme: 'danger' },
  invalid: { label: '信息不全', theme: 'default' }
};

const parsedRows = computed(() => parseRecordingText(rawText.value, defaultBatch.value));

const counts = computed(() => ({
  attach: preview.value.filter((row) => row.match === 'attach').length,
  update: preview.value.filter((row) => row.match === 'update').length,
  newVariant: preview.value.filter((row) => row.match === 'new-variant').length,
  missing: preview.value.filter((row) => row.match === 'missing-entry').length,
  duplicate: preview.value.filter((row) => row.match === 'duplicate').length,
  conflict: preview.value.filter((row) => row.match === 'conflict').length,
  invalid: preview.value.filter((row) => row.match === 'invalid').length
}));
const actionableCount = computed(() => counts.value.attach + counts.value.update + counts.value.newVariant);
const skippedCount = computed(() => counts.value.missing + counts.value.duplicate + counts.value.conflict + counts.value.invalid);

watch(visible, (open) => {
  if (!open) return;
  step.value = 'paste';
  result.value = null;
});

const runPreview = () => {
  preview.value = previewRecordingImport(store.entries, parsedRows.value);
  step.value = 'preview';
};

const confirmImport = () => {
  result.value = store.applyRecordingImport(preview.value);
  step.value = 'done';
};

const importMore = () => {
  rawText.value = '';
  preview.value = [];
  result.value = null;
  step.value = 'paste';
};
</script>

<template>
  <t-dialog v-model:visible="visible" header="田野录音核对导入" width="1080px" :footer="false" class="recording-dialog">
    <div v-if="step === 'paste'" class="recording-paste">
      <t-alert theme="info">
        从录音登记表（Excel / 表格）直接复制粘贴，列顺序为：批次、词形、方言、发音人、文件名、时长。
        支持制表符或 | 分隔；省略批次列时将使用下方统一批次。确认导入前会先预览匹配结果，不会直接改动词条。
      </t-alert>
      <div class="paste-toolbar">
        <label class="batch-field"><span>统一批次</span><t-input v-model="defaultBatch" placeholder="如 FW-2026-09，行内批次列为空时使用" /></label>
        <button class="sample-link" @click="rawText = SAMPLE">填入示例数据</button>
      </div>
      <t-textarea
        v-model="rawText"
        :autosize="{ minRows: 10, maxRows: 16 }"
        placeholder="批次	词形	方言	发音人	文件名	时长&#10;FW-2026-09	ŋgɨ³³	北坡话	和秀珍	FW2026-09-001.wav	00:01:18"
      />
      <div class="dialog-actions">
        <span class="paste-count">{{ parsedRows.length }} 行待核对</span>
        <t-button variant="outline" @click="visible = false">取消</t-button>
        <t-button theme="primary" :disabled="!parsedRows.length" @click="runPreview">解析并预览匹配</t-button>
      </div>
    </div>

    <div v-else-if="step === 'preview'" class="recording-preview">
      <div class="preview-summary">
        <div class="summary-block ok"><strong>{{ actionableCount }}</strong><span>可导入 · 新挂 {{ counts.attach }} / 更新 {{ counts.update }} / 新建变体 {{ counts.newVariant }}</span></div>
        <div class="summary-block skip"><strong>{{ skippedCount }}</strong><span>将跳过 · 缺词条 {{ counts.missing }} / 重复 {{ counts.duplicate }} / 冲突 {{ counts.conflict }} / 信息不全 {{ counts.invalid }}</span></div>
      </div>
      <t-alert v-if="counts.duplicate || counts.conflict" theme="warning">
        检测到重复录音号：批次内重复的行只会保留首次出现的记录；已核对过的录音号再次导入时只更新信息，不会重复挂载。
      </t-alert>
      <div class="preview-table">
        <div class="preview-row header">
          <span>#</span><span>核对结果</span><span>词形</span><span>方言</span><span>发音人</span><span>文件名</span><span>时长</span><span>说明</span>
        </div>
        <div v-for="row in preview" :key="row.rowIndex" class="preview-row" :class="`match-${row.match}`">
          <span>{{ row.rowIndex }}</span>
          <span><t-tag size="small" variant="light" :theme="matchMeta[row.match].theme">{{ matchMeta[row.match].label }}</t-tag></span>
          <span>{{ row.form || '—' }}</span>
          <span>{{ row.dialect || '—' }}</span>
          <span>{{ row.speaker || '—' }}</span>
          <span class="mono">{{ row.fileName || '—' }}</span>
          <span class="mono">{{ row.duration || '—' }}</span>
          <span class="preview-note">{{ row.note }}</span>
        </div>
      </div>
      <div class="dialog-actions">
        <t-button variant="outline" @click="step = 'paste'">返回修改</t-button>
        <t-button theme="primary" :disabled="!actionableCount" @click="confirmImport">
          确认导入 {{ actionableCount }} 条录音
        </t-button>
      </div>
    </div>

    <div v-else class="recording-done">
      <div class="done-icon">✓</div>
      <h3>批次已写入版本记录</h3>
      <div v-if="result" class="done-stats">
        <div><strong>{{ result.attached }}</strong><span>新挂录音</span></div>
        <div><strong>{{ result.updated }}</strong><span>更新已核对</span></div>
        <div><strong>{{ result.variantsCreated }}</strong><span>新建方言变体</span></div>
        <div><strong>{{ result.skipped }}</strong><span>跳过</span></div>
      </div>
      <p>录音已挂到对应方言变体并生成来源记录，词条页的方言变体卡片中可查看每条的核对状态；本次导入可撤销或在版本记录中恢复。</p>
      <div class="dialog-actions">
        <t-button variant="outline" @click="importMore">继续导入下一批</t-button>
        <t-button theme="primary" @click="visible = false">完成</t-button>
      </div>
    </div>
  </t-dialog>
</template>
