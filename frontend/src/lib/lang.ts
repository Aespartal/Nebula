// ffprobe da códigos de 3 letras (spa, eng, fre…) y los archivos externos de 2 (es, en): se unifican a 2 letras.
const ISO3_TO_2: Record<string, string> = {
  spa: "es", esl: "es", eng: "en", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", jpn: "ja",
  cat: "ca", eus: "eu", baq: "eu", glg: "gl", rus: "ru", chi: "zh", zho: "zh", kor: "ko", ara: "ar", dut: "nl", nld: "nl",
  pol: "pl", swe: "sv", nor: "no", dan: "da", fin: "fi", tur: "tr", hin: "hi", heb: "he", ukr: "uk", ces: "cs", cze: "cs",
};

export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toLowerCase().split(/[-_]/)[0];
  if (c.length === 2) return c;
  return ISO3_TO_2[c] ?? null;
}

export function languageName(code: string | null): string {
  if (!code) return "Sin idioma";
  const n = normalizeLang(code) ?? code;
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language" }).of(n) ?? code;
    return name.charAt(0).toLocaleUpperCase("es") + name.slice(1); // Intl da «español»; en una lista queda mejor «Español»
  } catch { return code; }
}
