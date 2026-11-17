import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ESTADO_VALUES, parseParam, type Estado } from "./catalogView";

/**
 * Orden y estado de una lista, guardados en la URL (`?orden=…&estado=…`) para que sobrevivan a «atrás» y a recargar.
 * Los valores por defecto no se escriben, así la URL normal queda limpia. No llena el historial: reemplaza la entrada.
 */
export function useCatalogView<O extends string>(orders: readonly O[]) {
  const [params, setParams] = useSearchParams();
  const order = parseParam(params.get("orden"), orders, orders[0]);
  const estado = parseParam(params.get("estado"), ESTADO_VALUES, "todas");

  const set = useCallback((key: "orden" | "estado", value: string, def: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value === def) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true }), [setParams]);

  return {
    order, estado,
    setOrder: (o: O) => set("orden", o, orders[0]),
    setEstado: (e: Estado) => set("estado", e, "todas"),
  };
}
