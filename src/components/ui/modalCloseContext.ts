import { createContext, useContext } from 'react';

/** Dismiss the enclosing Modal/Sheet with its exit animation, then run `after`
 * (defaults to the surface's onClose). */
export type RequestClose = (after?: () => void) => void;

export const ModalCloseContext = createContext<RequestClose>((after) => after?.());

export const useModalClose = (): RequestClose => useContext(ModalCloseContext);
