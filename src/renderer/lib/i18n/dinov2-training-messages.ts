import type { AppLocale } from "@/lib/i18n/types"
import type { Dinov2ObjectiveId } from "@/lib/training-dinov2-api"

export type Dinov2TrainingMessages = {
  pageTitle: string
  pageSubtitle: string
  backAria: string
  trainingNamePlaceholder: string
  createJobAria: string
  labelObjective: string
  labelBaseWeight: string
  labelZipData: string
  zipHint: string
  labelCommonParams: string
  noModelsOption: string
  uploadedWeightOption: (name: string) => string
  uploadWeightAria: string
  zipPlaceholder: string
  uploadZipAria: string
  paramEpochs: string
  paramBatch: string
  paramLr: string
  paramWeightDecay: string
  paramImgsz: string
  paramWorkers: string
  paramDevice: string
  paramFreezeBackbone: string
  paramFreezeBackboneHint: string
  switchOn: string
  switchOff: string
  startTraining: string
  trainingInProgress: string
  pipelineNotReady: string
  backendModeLocal: string
  backendModeRemote: (endpoint: string) => string
  datasetUploading: string
  datasetUnpacking: string
  errors: {
    nameRequired: string
    nameInvalid: string
    nameDuplicate: string
    connectBackend: string
    createWorkspaceFirst: string
    uploadedWeightFallback: string
    selectArchBeforeUpload: string
    datasetUploadFailed: string
  }
  objectives: Record<Dinov2ObjectiveId, string>
  checklist: {
    backendChecking: string
    backendDisconnected: string
    backendConnected: string
    nameDuplicate: string
    jobCreated: (jobSlug: string) => string
    nameThenCreate: string
    createWorkspaceFirst: string
    weightNeedWorkspace: string
    weightBinding: string
    weightNoRegistry: string
    weightSelectOrUpload: string
    weightReady: string
    datasetNeedWorkspace: string
    datasetReady: (count: number, filename?: string | null) => string
    datasetUploadZip: string
    pipelinePending: string
  }
}

const zhCN: Dinov2TrainingMessages = {
  pageTitle: "DINOv2 训练",
  pageSubtitle: "每次训练在 external/temp/dinov2/<训练名>/ 独立目录",
  backAria: "返回模型训练",
  trainingNamePlaceholder: "输入本次训练名称…",
  createJobAria: "创建训练任务",
  labelObjective: "训练目标",
  labelBaseWeight: "预训练权重",
  labelZipData: "图像数据集 ZIP",
  zipHint: "ZIP 内需包含 jpg/png 等图像（支持 ImageFolder 或平铺目录）",
  labelCommonParams: "常用参数",
  noModelsOption: "无可用权重（请先 install-resources）",
  uploadedWeightOption: (name) => `已上传：${name}`,
  uploadWeightAria: "上传 .pth 权重",
  zipPlaceholder: "未选择数据集",
  uploadZipAria: "选择或上传 ZIP 数据集",
  paramEpochs: "Epochs",
  paramBatch: "Batch size",
  paramLr: "学习率",
  paramWeightDecay: "Weight decay",
  paramImgsz: "输入尺寸 (imgsz)",
  paramWorkers: "DataLoader workers",
  paramDevice: "Device",
  paramFreezeBackbone: "冻结骨干网络",
  paramFreezeBackboneHint: "线性探针时通常保持开启",
  switchOn: "开",
  switchOff: "关",
  startTraining: "开始训练",
  trainingInProgress: "训练中…",
  pipelineNotReady: "训练管线尚未实现，可先配置工作区与参数",
  backendModeLocal: "本地后端",
  backendModeRemote: (endpoint) => `远程后端 · ${endpoint}`,
  datasetUploading: "正在上传 ZIP…",
  datasetUnpacking: "上传完成，正在解压…",
  errors: {
    nameRequired: "请输入训练名称",
    nameInvalid: "训练名称无效",
    nameDuplicate: "该名称已存在，请更换",
    connectBackend: "请先连接后端",
    createWorkspaceFirst: "请先创建训练任务",
    uploadedWeightFallback: "已上传权重",
    selectArchBeforeUpload: "上传自定义权重前请先在下方下拉框选择对应架构",
    datasetUploadFailed: "数据集上传或解压失败",
  },
  objectives: {
    linear_probe: "线性探针",
    fine_tune: "全量微调",
    partial_tune: "部分解冻",
  },
  checklist: {
    backendChecking: "正在检测后端连接…",
    backendDisconnected: "后端未连接",
    backendConnected: "后端已连接",
    nameDuplicate: "训练名称与已有任务重复",
    jobCreated: (slug) => `训练目录已创建：${slug}`,
    nameThenCreate: "输入名称后点击 + 创建目录",
    createWorkspaceFirst: "先创建本次训练工作区",
    weightNeedWorkspace: "先创建工作区",
    weightBinding: "正在绑定权重…",
    weightNoRegistry: "资源目录中无 DINOv2 权重",
    weightSelectOrUpload: "请选择或上传 .pth 预训练权重",
    weightReady: "预训练权重已就绪",
    datasetNeedWorkspace: "先创建工作区",
    datasetReady: (count, filename) =>
      filename ? `数据集已就绪（${filename}，${count} 张图）` : `数据集已就绪（${count} 张图）`,
    datasetUploadZip: "请上传图像数据集 ZIP",
    pipelinePending: "训练启动：管线开发中",
  },
}

const en: Dinov2TrainingMessages = {
  pageTitle: "DINOv2 Training",
  pageSubtitle: "Each run uses external/temp/dinov2/<name>/",
  backAria: "Back to model training",
  trainingNamePlaceholder: "Enter a training name…",
  createJobAria: "Create training job",
  labelObjective: "Training objective",
  labelBaseWeight: "Pretrained weights",
  labelZipData: "Image dataset ZIP",
  zipHint: "ZIP should contain jpg/png images (ImageFolder or flat layout)",
  labelCommonParams: "Common parameters",
  noModelsOption: "No weights available (run install-resources first)",
  uploadedWeightOption: (name) => `Uploaded: ${name}`,
  uploadWeightAria: "Upload .pth weights",
  zipPlaceholder: "No dataset selected",
  uploadZipAria: "Select or upload ZIP dataset",
  paramEpochs: "Epochs",
  paramBatch: "Batch size",
  paramLr: "Learning rate",
  paramWeightDecay: "Weight decay",
  paramImgsz: "Input size (imgsz)",
  paramWorkers: "DataLoader workers",
  paramDevice: "Device",
  paramFreezeBackbone: "Freeze backbone",
  paramFreezeBackboneHint: "Usually enabled for linear probe",
  switchOn: "On",
  switchOff: "Off",
  startTraining: "Start training",
  trainingInProgress: "Training…",
  pipelineNotReady: "Training pipeline not implemented yet; workspace setup works",
  backendModeLocal: "Local backend",
  backendModeRemote: (endpoint) => `Remote backend · ${endpoint}`,
  datasetUploading: "Uploading ZIP…",
  datasetUnpacking: "Upload complete, extracting…",
  errors: {
    nameRequired: "Enter a training name",
    nameInvalid: "Invalid training name",
    nameDuplicate: "Name already exists",
    connectBackend: "Connect the backend first",
    createWorkspaceFirst: "Create a training job first",
    uploadedWeightFallback: "Uploaded weights",
    selectArchBeforeUpload: "Select the architecture from the dropdown before uploading a custom .pth",
    datasetUploadFailed: "Dataset upload or unpack failed",
  },
  objectives: {
    linear_probe: "Linear probe",
    fine_tune: "Full fine-tune",
    partial_tune: "Partial unfreeze",
  },
  checklist: {
    backendChecking: "Checking backend…",
    backendDisconnected: "Backend disconnected",
    backendConnected: "Backend connected",
    nameDuplicate: "Training name already exists",
    jobCreated: (slug) => `Workspace created: ${slug}`,
    nameThenCreate: "Enter a name and click + to create",
    createWorkspaceFirst: "Create a workspace first",
    weightNeedWorkspace: "Create workspace first",
    weightBinding: "Binding weights…",
    weightNoRegistry: "No DINOv2 weights in registry",
    weightSelectOrUpload: "Select or upload a .pth checkpoint",
    weightReady: "Pretrained weights ready",
    datasetNeedWorkspace: "Create workspace first",
    datasetReady: (count, filename) =>
      filename ? `Dataset ready (${filename}, ${count} images)` : `Dataset ready (${count} images)`,
    datasetUploadZip: "Upload an image dataset ZIP",
    pipelinePending: "Start training: pipeline in development",
  },
}

const BY_LOCALE: Record<AppLocale, Dinov2TrainingMessages> = { "zh-CN": zhCN, en }

export function getDinov2TrainingMessages(locale: AppLocale): Dinov2TrainingMessages {
  return BY_LOCALE[locale] ?? zhCN
}
