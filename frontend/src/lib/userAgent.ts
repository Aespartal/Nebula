// Traduce el user-agent guardado con cada sesión a algo que una persona reconozca: «Chrome en Windows».
// Solo para mostrar. El user-agent lo controla el cliente: nunca se usa para decidir nada de seguridad.

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"], // Brave y Vivaldi se anuncian como Chrome
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

// El orden importa: un iPhone dice «like Mac OS X», Android dice «Linux» y ChromeOS dice «X11».
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux|X11/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua?.trim()) return "Dispositivo desconocido";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? (system ? `Navegador desconocido en ${system}` : "Navegador desconocido");
}
