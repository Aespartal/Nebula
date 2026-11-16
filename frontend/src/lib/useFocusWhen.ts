import { useEffect, type RefObject } from "react";

/** Mueve el foco a un elemento (normalmente el <h1>) cuando la página ya tiene sus datos. */
export function useFocusWhen(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    if (ready) ref.current?.focus({ preventScroll: true });
  }, [ready, ref]);
}
