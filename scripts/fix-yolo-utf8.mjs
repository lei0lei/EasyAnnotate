import fs from "node:fs"

const filePath = new URL("../src/renderer/pages/models-training-yolo.tsx", import.meta.url)
let s = fs.readFileSync(filePath, "utf8")

const pairs = [
  ['{ id: "detect", label: "??" }', '{ id: "detect", label: "检测" }'],
  ['{ id: "segment", label: "??" }', '{ id: "segment", label: "分割" }'],
  ['{ id: "pose", label: "??" }', '{ id: "pose", label: "姿态" }'],
  ['{ id: "classify", label: "??" }', '{ id: "classify", label: "分类" }'],
  ['warningText ?? "??????????????"', 'warningText ?? "权重与当前模型族或任务不匹配"'],
  ['?? "?????"', '?? "已上传权重"'],
  ['if (backendOk === null) return { label: "???????", tone: "pending" }', 'if (backendOk === null) return { label: "正在检测后端…", tone: "pending" }'],
  ['if (!backendOk) return { label: "?? API ?????????????????????", tone: "error" }', 'if (!backendOk) return { label: "后端 API 未连接，请先在设置中启动本地或连接远程后端", tone: "error" }'],
  ['return { label: "?? API ???", tone: "done" }', 'return { label: "后端 API 已连接", tone: "done" }'],
  ['if (nameDuplicate) return { label: "?????????????????????", tone: "error" }', 'if (nameDuplicate) return { label: "训练名称已被使用，请重新输入或删除同名项目", tone: "error" }'],
  ['if (jobReady) return { label: `????????external/temp/${jobSlug}?`, tone: "done" }', 'if (jobReady) return { label: `已创建训练任务（external/temp/${jobSlug}）`, tone: "done" }'],
  ['if (slugPreview) return { label: "??????????? + ?????", tone: "pending" }', 'if (slugPreview) return { label: "填写训练名称后，点右侧 + 创建工作区", tone: "pending" }'],
  ['return { label: "??????????", tone: "pending" }', 'return { label: "请先填写并创建工作区", tone: "pending" }'],
  ['if (!jobReady) return { label: "???????", tone: "pending" }', 'if (!jobReady) return { label: "请先创建工作区", tone: "pending" }'],
  ['if (baseModelBusy) return { label: "?????????", tone: "pending" }', 'if (baseModelBusy) return { label: "正在绑定基础模型…", tone: "pending" }'],
  ['return { label: "? registry ?????? .pt ??", tone: "pending" }', 'return { label: "无 registry 模型，请上传 .pt 权重", tone: "pending" }'],
  ['return { label: "?????????? .pt", tone: "pending" }', 'return { label: "请选择列表权重或上传 .pt", tone: "pending" }'],
  ['if (!baseModelValid) return { label: "???????", tone: "error" }', 'if (!baseModelValid) return { label: "初始权重不可用", tone: "error" }'],
  ['return { label: "???????", tone: "done" }', 'return { label: "初始权重已就绪", tone: "done" }'],
  ['const name = datasetZipFilename ? `?${datasetZipFilename}?` : ""', 'const name = datasetZipFilename ? `（${datasetZipFilename}）` : ""'],
  ['return { label: `??????${name}`, tone: "done" }', 'return { label: `数据集已就绪${name}`, tone: "done" }'],
  ['return { label: "????????? ZIP ???", tone: "pending" }', 'return { label: "请点击右侧图标选择 ZIP 数据集", tone: "pending" }'],
  ['return { label: "??? ZIP ???", tone: "pending" }', 'return { label: "请上传 ZIP 数据集", tone: "pending" }'],
  ['setNameError("?????????")', 'setNameError("请填写本次训练名称")'],
  ['setNameError("??????")', 'setNameError("训练名称无效")'],
  ['setNameError("?????????????????????")', 'setNameError("训练名称已被使用，请重新输入或删除同名项目")'],
  ['setNameError("??????")', 'setNameError("请先连接后端")'],
  ['setDatasetError("???????")', 'setDatasetError("请先创建工作区")'],
  ['setDatasetError("????????? ZIP")', 'setDatasetError("远程后端请使用上传 ZIP")'],
  ['setDatasetError("???????? backend ??")', 'setDatasetError("请先在设置中选择 backend 目录")'],
  ['title: "?? YOLO ????? ZIP"', 'title: "选择 YOLO 训练数据集 ZIP"'],
  ['copy.errorMessage || "???????"', 'copy.errorMessage || "复制数据集失败"'],
  ['nameDuplicate ? "?????????????????????" : null', 'nameDuplicate ? "训练名称已被使用，请重新输入或删除同名项目" : null'],
  ['>YOLO ??</h1>', '>YOLO 训练</h1>'],
  ['????? <code className="text-xs">external/temp/&lt;???&gt;/</code> ????', '每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录'],
  ['placeholder="?????????"', 'placeholder="输入本次训练名称…"'],
  ['asChild variant="ghost" size="icon" className="shrink-0" aria-label="??????"', 'asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回模型训练"'],
  ['className="h-9 w-9 shrink-0"\n                  aria-label="??????"\n                  disabled={\n                    !backendOk ||\n                    prepareBusy', 'className="h-9 w-9 shrink-0"\n                  aria-label="创建训练任务"\n                  disabled={\n                    !backendOk ||\n                    prepareBusy'],
  ['<p className="text-xs font-medium text-muted-foreground">???</p>', '<p className="text-xs font-medium text-muted-foreground">模型族</p>'],
  ['<p className="text-xs font-medium text-muted-foreground">??</p>', '<p className="text-xs font-medium text-muted-foreground">任务</p>'],
  ['<p className="text-xs font-medium text-muted-foreground">????</p>', '<p className="text-xs font-medium text-muted-foreground">初始权重</p>'],
  ['<p className="text-xs font-medium text-muted-foreground">zip??</p>', '<p className="text-xs font-medium text-muted-foreground">zip数据</p>'],
  ['<option value="">???????? install-resources?</option>', '<option value="">无可用模型（请先 install-resources）</option>'],
  ['<option value={UPLOADED_WEIGHT_VALUE}>????{uploadedWeightLabel}</option>', '<option value={UPLOADED_WEIGHT_VALUE}>已上传：{uploadedWeightLabel}</option>'],
  ['aria-label="???? .pt"', 'aria-label="上传权重 .pt"'],
  ['placeholder="???????"', 'placeholder="尚未选择数据集"'],
  ['aria-label="????? ZIP ???"', 'aria-label="选择或上传 ZIP 数据集"'],
  ['<p className="text-xs font-medium text-muted-foreground">????</p>', '<p className="text-xs font-medium text-muted-foreground">常用参数</p>'],
  ['<span className="text-muted-foreground">???? epochs</span>', '<span className="text-muted-foreground">训练轮数 epochs</span>'],
  ['title="???????"', 'title="留空表示不限制"'],
  ['\n                    ????????\n', '\n                    训练时间（小时）\n'],
  ['placeholder="???"', 'placeholder="不限制"'],
  ['<span className="text-muted-foreground">???? workers</span>', '<span className="text-muted-foreground">数据加载 workers</span>'],
  ['<span className="text-muted-foreground">??? batch</span>', '<span className="text-muted-foreground">批大小 batch</span>'],
  ['<span className="text-muted-foreground">???? imgsz</span>', '<span className="text-muted-foreground">输入尺寸 imgsz</span>'],
  ['<span className="text-muted-foreground">??</span>', '<span className="text-muted-foreground">设备</span>'],
  ['title="????"', 'title="图像增强"'],
  ['title="???"', 'title="优化器"'],
  ['\n                    ????\n', '\n                    训练中…\n'],
  ['\n                  "????"\n', '\n                  "开始训练"\n'],
]

pairs.sort((a, b) => b[0].length - a[0].length)
for (const [from, to] of pairs) {
  if (s.includes(from)) s = s.split(from).join(to)
}
fs.writeFileSync(filePath, s, "utf8")
console.log(s.includes("YOLO 训练") ? "fixed" : "failed")
