// Foto da conta: recorta a imagem escolhida no centro (quadrado) e reduz antes de enviar,
// para o servidor guardar poucas dezenas de KB em vez da foto inteira do celular.

/** Lado da foto enviada, em pixels (a maior exibição é de 44 px; sobra para telas de alta densidade). */
const SIZE = 256;

/** Data URL JPEG quadrada da imagem, ou erro se o navegador não conseguir abri-la. */
export async function squarePicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('imagem vazia');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(SIZE, side);
    const ctx = canvas.getContext('2d')!;
    // JPEG não tem transparência: o fundo transparente de um PNG ficaria preto.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
