import type { AppLocale } from "@/lib/i18n/types"
import type { YoloTaskId } from "@/lib/training-yolo-api"

export type YoloTrainingMessages = {
  pageTitle: string
  pageSubtitle: string
  backAria: string
  trainingNamePlaceholder: string
  createJobAria: string
  labelFamily: string
  labelTask: string
  labelBaseWeight: string
  labelZipData: string
  zipHintRemote: string
  zipHintUpload: string
  labelCommonParams: string
  noModelsOption: string
  uploadedWeightOption: (name: string) => string
  uploadWeightAria: string
  zipPlaceholder: string
  uploadZipAria: string
  paramEpochs: string
  paramTimeHours: string
  paramTimeHoursTitle: string
  paramTimePlaceholder: string
  paramWorkers: string
  paramBatch: string
  paramImgsz: string
  paramDevice: string
  paramExportOnnx: string
  paramExportOnnxHint: string
  paramOnnxSimplify: string
  paramOnnxSimplifyHint: string
  boardAugment: string
  boardOptimizer: string
  switchOn: string
  switchOff: string
  boolNo: string
  boolYes: string
  startTraining: string
  trainingInProgress: string
  backendModeLocal: string
  backendModeRemote: (endpoint: string) => string
  datasetUploading: (percent: number) => string
  datasetUnpacking: string
  datasetCopying: string
  errors: {
    weightMismatch: string
    nameRequired: string
    nameInvalid: string
    nameDuplicate: string
    connectBackend: string
    createWorkspaceFirst: string
    remoteZipUpload: string
    pickBackendDir: string
    copyDatasetFailed: string
    uploadedWeightFallback: string
    datasetUploadTimeout: string
    datasetUploadNetwork: string
    datasetUnpackTimeout: string
  }
  ipc: {
    pickDatasetZipTitle: string
    pickWeightPtTitle: string
  }
  tasks: Record<YoloTaskId, string>
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
    weightInvalid: string
    weightReady: string
    datasetNeedWorkspace: string
    datasetReady: (filename?: string | null) => string
    datasetPickZip: string
    datasetUploadZip: string
  }
  historyDetail: {
    tabLogs: string
    tabParams: string
    tabResults: string
    tabModels: string
    loadingLogs: string
    loadingParams: string
    loadingResults: string
    loadingModels: string
    modelsEmpty: string
    modelsRefreshing: string
    downloadModel: string
    downloadingModel: string
    modelSavedTo: (path: string) => string
    modelDownloadFailed: (detail: string) => string
    backendDisconnected: string
    requestFailed: (detail: string) => string
    resultsApiMissing: string
    modelsApiMissing: string
  }
}

const zhCN: YoloTrainingMessages = {
  pageTitle: "YOLO 训练",
  pageSubtitle: "每次训练在 external/temp/<训练名>/ 独立目录",
  backAria: "返回模型训练",
  trainingNamePlaceholder: "输入本次训练名称…",
  createJobAria: "创建训练任务",
  labelFamily: "模型族",
  labelTask: "任务",
  labelBaseWeight: "初始权重",
  labelZipData: "zip数据",
  zipHintRemote: "HTTP 上传至远程",
  zipHintUpload: "选文件 · WebSocket 分片上传",
  labelCommonParams: "常用参数",
  noModelsOption: "无可用模型（请先 install-resources）",
  uploadedWeightOption: (name) => `已上传：${name}`,
  uploadWeightAria: "上传权重 .pt",
  zipPlaceholder: "尚未选择数据集",
  uploadZipAria: "选择或上传 ZIP 数据集",
  paramEpochs: "训练轮数 epochs",
  paramTimeHours: "训练时间（小时）",
  paramTimeHoursTitle: "留空表示不限制",
  paramTimePlaceholder: "不限制",
  paramWorkers: "数据加载 workers",
  paramBatch: "批大小 batch",
  paramImgsz: "输入尺寸 imgsz",
  paramDevice: "设备",
  paramExportOnnx: "训练后导出 ONNX",
  paramExportOnnxHint: "训练成功后使用 Ultralytics export，输入尺寸与上方 imgsz 一致",
  paramOnnxSimplify: "ONNX simplify",
  paramOnnxSimplifyHint: "用 onnxslim 精简图；Windows 本地建议关闭，避免导出卡住",
  boardAugment: "图像增强",
  boardOptimizer: "优化器",
  switchOn: "启用",
  switchOff: "关闭",
  boolNo: "否",
  boolYes: "是",
  startTraining: "开始训练",
  trainingInProgress: "训练中…",
  backendModeLocal: "本地后端",
  backendModeRemote: (endpoint) => `远程后端 · ${endpoint}`,
  datasetUploading: (percent) => `正在上传 ZIP… ${percent}%`,
  datasetUnpacking: "上传完成，正在解压数据集…",
  datasetCopying: "正在复制 ZIP 到工作区…",
  errors: {
    weightMismatch: "权重与当前模型族或任务不匹配",
    nameRequired: "请填写本次训练名称",
    nameInvalid: "训练名称无效",
    nameDuplicate: "训练名称已被使用，请重新输入或删除同名项目",
    connectBackend: "请先连接后端",
    createWorkspaceFirst: "请先创建工作区",
    remoteZipUpload: "远程后端请使用上传 ZIP",
    pickBackendDir: "请先在设置中选择 backend 目录",
    copyDatasetFailed: "复制数据集失败",
    uploadedWeightFallback: "已上传权重",
    datasetUploadTimeout: "上传 ZIP 超时（最长 5 小时），请检查网络或稍后续传",
    datasetUploadNetwork: "上传失败，无法连接后端",
    datasetUnpackTimeout: "解压数据集超时，请检查后端日志或 ZIP 是否过大",
  },
  ipc: {
    pickDatasetZipTitle: "选择 YOLO 训练数据集 ZIP",
    pickWeightPtTitle: "选择 .pt 权重文件",
  },
  tasks: {
    detect: "检测",
    segment: "分割",
    pose: "姿态",
    obb: "OBB",
    classify: "分类",
  },
  checklist: {
    backendChecking: "正在检测后端…",
    backendDisconnected: "后端 API 未连接，请先在设置中启动本地或连接远程后端",
    backendConnected: "后端 API 已连接",
    nameDuplicate: "训练名称已被使用，请重新输入或删除同名项目",
    jobCreated: (jobSlug) => `已创建训练任务（external/temp/${jobSlug}）`,
    nameThenCreate: "填写训练名称后，点右侧 + 创建工作区",
    createWorkspaceFirst: "请先填写并创建工作区",
    weightNeedWorkspace: "请先创建工作区",
    weightBinding: "正在绑定基础模型…",
    weightNoRegistry: "无 registry 模型，请上传 .pt 权重",
    weightSelectOrUpload: "请选择列表权重或上传 .pt",
    weightInvalid: "初始权重不可用",
    weightReady: "初始权重已就绪",
    datasetNeedWorkspace: "请先创建工作区",
    datasetReady: (filename) =>
      filename?.trim() ? `数据集已就绪（${filename.trim()}）` : "数据集已就绪",
    datasetPickZip: "请点击右侧图标选择 ZIP 数据集",
    datasetUploadZip: "请上传 ZIP 数据集",
  },
  historyDetail: {
    tabLogs: "日志",
    tabParams: "参数",
    tabResults: "结果",
    tabModels: "模型下载",
    loadingLogs: "正在读取…",
    loadingParams: "正在加载参数…",
    loadingResults: "正在扫描结果图…",
    loadingModels: "正在扫描模型文件…",
    modelsEmpty: "暂无 .pt 或 .onnx 文件；训练完成并导出后会出现 best.pt、last.pt 等权重。",
    modelsRefreshing: "训练中，模型列表将自动刷新",
    downloadModel: "下载",
    downloadingModel: "请选择保存目录，正在写入文件…",
    modelSavedTo: (path) => `已保存至 ${path}`,
    modelDownloadFailed: (detail) => `下载失败：${detail}`,
    backendDisconnected: "后端未连接，无法加载。请先在设置中连接远程或启动本地后端。",
    requestFailed: (detail) => `加载失败：${detail}`,
    resultsApiMissing: "远程后端可能未更新，缺少结果图接口（/history/.../results）",
    modelsApiMissing: "远程后端可能未更新，缺少模型下载接口（/history/.../models）",
  },
}

const en: YoloTrainingMessages = {
  pageTitle: "YOLO Training",
  pageSubtitle: "Each run uses its own directory under external/temp/<name>/",
  backAria: "Back to model training",
  trainingNamePlaceholder: "Enter a training name…",
  createJobAria: "Create training job",
  labelFamily: "Model family",
  labelTask: "Task",
  labelBaseWeight: "Base weights",
  labelZipData: "Dataset ZIP",
  zipHintRemote: "Upload ZIP over HTTP (remote)",
  zipHintUpload: "Pick file · WebSocket chunked upload",
  labelCommonParams: "Common parameters",
  noModelsOption: "No models available (run install-resources first)",
  uploadedWeightOption: (name) => `Uploaded: ${name}`,
  uploadWeightAria: "Upload .pt weights",
  zipPlaceholder: "No dataset selected",
  uploadZipAria: "Select or upload ZIP dataset",
  paramEpochs: "Epochs",
  paramTimeHours: "Time limit (hours)",
  paramTimeHoursTitle: "Leave empty for no limit",
  paramTimePlaceholder: "No limit",
  paramWorkers: "DataLoader workers",
  paramBatch: "Batch size",
  paramImgsz: "Image size (imgsz)",
  paramDevice: "Device",
  paramExportOnnx: "Export ONNX after training",
  paramExportOnnxHint: "Runs Ultralytics export when training finishes; imgsz matches the value above",
  paramOnnxSimplify: "ONNX simplify",
  paramOnnxSimplifyHint: "Slim the graph with onnxslim; keep off on Windows local to avoid export hangs",
  boardAugment: "Augmentation",
  boardOptimizer: "Optimizer",
  switchOn: "On",
  switchOff: "Off",
  boolNo: "No",
  boolYes: "Yes",
  startTraining: "Start training",
  trainingInProgress: "Training…",
  backendModeLocal: "Local backend",
  backendModeRemote: (endpoint) => `Remote backend · ${endpoint}`,
  datasetUploading: (percent) => `Uploading ZIP… ${percent}%`,
  datasetUnpacking: "Upload complete, extracting dataset…",
  datasetCopying: "Copying ZIP to workspace…",
  errors: {
    weightMismatch: "Weights do not match the selected model family or task",
    nameRequired: "Enter a training name",
    nameInvalid: "Invalid training name",
    nameDuplicate: "This name is already in use; choose another or delete the existing job",
    connectBackend: "Connect the backend first",
    createWorkspaceFirst: "Create a workspace first",
    remoteZipUpload: "Use ZIP upload on remote backend",
    pickBackendDir: "Select the backend directory in Settings first",
    copyDatasetFailed: "Failed to copy dataset",
    uploadedWeightFallback: "Uploaded weights",
    datasetUploadTimeout: "ZIP upload timed out (5h limit); check the network or resume later",
    datasetUploadNetwork: "Upload failed; could not reach the backend",
    datasetUnpackTimeout: "Dataset extraction timed out; check backend logs or ZIP size",
  },
  ipc: {
    pickDatasetZipTitle: "Select YOLO training dataset ZIP",
    pickWeightPtTitle: "Select .pt weight file",
  },
  tasks: {
    detect: "Detect",
    segment: "Segment",
    pose: "Pose",
    obb: "OBB",
    classify: "Classify",
  },
  checklist: {
    backendChecking: "Checking backend…",
    backendDisconnected: "Backend API is not connected; start local or connect remote in Settings",
    backendConnected: "Backend API connected",
    nameDuplicate: "This training name is already in use",
    jobCreated: (jobSlug) => `Workspace created (external/temp/${jobSlug})`,
    nameThenCreate: "Enter a name, then click + to create workspace",
    createWorkspaceFirst: "Enter a name and create workspace first",
    weightNeedWorkspace: "Create a workspace first",
    weightBinding: "Binding base weights…",
    weightNoRegistry: "No registry models; upload a .pt file",
    weightSelectOrUpload: "Select from list or upload .pt",
    weightInvalid: "Base weights are not valid",
    weightReady: "Base weights ready",
    datasetNeedWorkspace: "Create a workspace first",
    datasetReady: (filename) =>
      filename?.trim() ? `Dataset ready (${filename.trim()})` : "Dataset ready",
    datasetPickZip: "Click the icon to choose a ZIP dataset",
    datasetUploadZip: "Upload a ZIP dataset",
  },
  historyDetail: {
    tabLogs: "Logs",
    tabParams: "Parameters",
    tabResults: "Results",
    tabModels: "Models",
    loadingLogs: "Loading logs…",
    loadingParams: "Loading parameters…",
    loadingResults: "Scanning result images…",
    loadingModels: "Scanning model files…",
    modelsEmpty: "No .pt or .onnx files yet. Weights such as best.pt appear after training finishes.",
    modelsRefreshing: "Training in progress; model list refreshes automatically",
    downloadModel: "Download",
    downloadingModel: "Choose a folder, then saving the file…",
    modelSavedTo: (path) => `Saved to ${path}`,
    modelDownloadFailed: (detail) => `Download failed: ${detail}`,
    backendDisconnected: "Backend is not connected. Connect remote or start local backend in Settings.",
    requestFailed: (detail) => `Failed to load: ${detail}`,
    resultsApiMissing: "Remote backend may be outdated (missing /history/.../results API)",
    modelsApiMissing: "Remote backend may be outdated (missing /history/.../models API)",
  },
}

const BY_LOCALE: Record<AppLocale, YoloTrainingMessages> = {
  "zh-CN": zhCN,
  en,
}

export function getYoloTrainingMessages(locale: AppLocale): YoloTrainingMessages {
  return BY_LOCALE[locale] ?? zhCN
}
