/** 项目标签名：仅小写字母、数字、下划线；无空格、无大写、无其它符号。 */
const PROJECT_TAG_NAME_RE = /^[a-z0-9_]+$/

export const PROJECT_TAG_NAME_RULE_MESSAGE =
  "标签名只能使用小写字母、数字和下划线，不能含空格、大写或其它字符。"

export function isValidProjectTagName(value: string): boolean {
  const t = value.trim()
  return t.length > 0 && PROJECT_TAG_NAME_RE.test(t)
}

/** 通过返回 null，失败返回面向用户的说明（含空名）。 */
export function validateProjectTagName(value: string): string | null {
  const t = value.trim()
  if (!t) return "名称不能为空"
  if (!PROJECT_TAG_NAME_RE.test(t)) return PROJECT_TAG_NAME_RULE_MESSAGE
  return null
}
