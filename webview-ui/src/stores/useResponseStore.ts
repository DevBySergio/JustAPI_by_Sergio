import { create } from 'zustand';
import { JustResponse } from '../../../src/models/Response';

interface ResponseState {
  response: JustResponse | null;
  hasResponse: boolean;
  setResponse: (response: JustResponse) => void;
  clearResponse: () => void;
}

export const useResponseStore = create<ResponseState>((set) => ({
  response: null,
  hasResponse: false,

  setResponse: (response) =>
    set({ response, hasResponse: true }),

  clearResponse: () =>
    set({ response: null, hasResponse: false }),
}));
