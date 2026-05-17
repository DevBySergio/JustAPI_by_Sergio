import { create } from 'zustand';
import { HistoryEntry } from '../../../src/models/HistoryEntry';

interface HistoryState {
  entries: HistoryEntry[];
  setEntries: (entries: HistoryEntry[]) => void;
  addEntry: (entry: HistoryEntry) => void;
  clearEntries: () => void;
  filterText: string;
  setFilterText: (text: string) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  filterText: '',

  setEntries: (entries) =>
    set({ entries }),

  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, 200),
    })),

  clearEntries: () =>
    set({ entries: [] }),

  setFilterText: (text) =>
    set({ filterText: text }),
}));
