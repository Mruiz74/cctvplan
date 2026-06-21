import * as pdfjsLib from 'pdfjs-dist'

// El worker se sirve desde unpkg con la misma versión que la instalada.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// Renderiza una página del PDF a imagen (dataURL) para usarla de fondo del plano.
export async function pdfABackground(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let pageNum = 1
  if (pdf.numPages > 1) {
    const n = parseInt(prompt(`El PDF tiene ${pdf.numPages} páginas. ¿Cuál usar como plano?`, '1'), 10)
    if (n >= 1 && n <= pdf.numPages) pageNum = n
  }
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  // JPEG para que ocupe menos en el guardado local.
  return { url: canvas.toDataURL('image/jpeg', 0.9), w: canvas.width, h: canvas.height }
}
