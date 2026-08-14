/**
 * Trigger a browser file download from an in-memory text document.
 * @param filename - suggested download name.
 * @param mime - MIME type of the body.
 * @param body - document text.
 * @returns nothing; the browser owns the save dialog.
 */
export function downloadText(filename: string, mime: string, body: string): void {
  const blob = new Blob([body], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
