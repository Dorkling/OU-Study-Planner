// tesseract loads from vendor the first time it's used
const base = new URL('vendor/tesseract/', location.href).href

let worker

// the worker is kept between reads, so it reports to the latest caller
let progress

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = () => reject(new Error(`Couldn't load the screenshot reader. Check your connection and try again.`))
    document.head.append(script)
  })
}

// read text from an image, progress is 0 to 1
export async function readImage(image, onProgress) {
  if (!window.Tesseract) await loadScript(`${base}tesseract.min.js`)
  progress = onProgress

  worker ||= await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    logger: m => m.status === 'recognizing text' && progress?.(m.progress)
  })

  const { data } = await worker.recognize(image)
  return data.text
}
