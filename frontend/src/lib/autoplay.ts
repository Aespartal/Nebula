// Lógica del «siguiente episodio»: pura y sin React, para poder probarla.

/** Segundos que se espera antes de pasar al siguiente episodio. Los suficientes para cancelar sin prisa. */
export const AUTOPLAY_SECONDS = 10;

/** Un paso de la cuenta atrás: baja un segundo y avisa al llegar a 0. Nunca baja de 0. */
export function countdownStep(remaining: number): { remaining: number; done: boolean } {
  const next = Math.max(0, Math.floor(remaining) - 1);
  return { remaining: next, done: next === 0 };
}

/**
 * ¿Debe arrancar solo el siguiente episodio? No si el usuario lo desactivó, no hay siguiente, ni si el vídeo está a pantalla
 * completa: al cambiar de página se saldría de ella de golpe y la cuenta atrás ni se vería.
 */
export function shouldAutoplay(o: { enabled: boolean; hasNext: boolean; fullscreen: boolean }): boolean {
  return o.enabled && o.hasNext && !o.fullscreen;
}
