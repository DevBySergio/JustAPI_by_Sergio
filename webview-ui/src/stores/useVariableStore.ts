import { create } from 'zustand';
import { Variable } from '../../../src/models/Variable';
import { VariableSet } from '../../../src/models/VariableSet';
import type { EnvWatch } from '../../../src/models/Environment';

interface VariableState {
  globalVariables: Variable[];
  collectionVariables: Map<string, Variable[]>;
  variableSets: VariableSet[];
  environmentUpdate: Promise<void> | null;
  environmentDrafts: Record<string, VariableSet>;
  envWatches: EnvWatch[];
  setEnvironmentUpdate: (promise: Promise<void>) => void;
  setEnvironmentDraft: (draft: VariableSet) => void;
  clearEnvironmentDraft: (id: string) => void;
  setEnvWatches: (watches: EnvWatch[]) => void;
  setGlobalVariables: (variables: Variable[]) => void;
  setCollectionVariables: (collectionId: string, variables: Variable[]) => void;
  setVariableSets: (sets: VariableSet[]) => void;
}

export const useVariableStore = create<VariableState>((set, get) => ({
  globalVariables: [],
  collectionVariables: new Map(),
  variableSets: [],
  environmentUpdate: null,
  environmentDrafts: {}, envWatches: [],
  setEnvWatches: envWatches => set({ envWatches }),
  setEnvironmentDraft: draft => set(state => ({ environmentDrafts: { ...state.environmentDrafts, [draft.id]: draft } })),
  clearEnvironmentDraft: id => set(state => {
    const drafts = { ...state.environmentDrafts }; delete drafts[id]; return { environmentDrafts: drafts };
  }),
  setEnvironmentUpdate: promise => {
    set({ environmentUpdate: promise });
    void promise.finally(() => { if (get().environmentUpdate === promise) { set({ environmentUpdate: null }); } }).catch(() => undefined);
  },

  setGlobalVariables: (globalVariables) =>
    set({ globalVariables }),

  setCollectionVariables: (collectionId, variables) =>
    set((state) => {
      const collectionVariables = new Map(state.collectionVariables);
      collectionVariables.set(collectionId, variables);
      return { collectionVariables };
    }),

  setVariableSets: (variableSets) =>
    set(state => ({ variableSets, environmentDrafts: Object.fromEntries(Object.entries(state.environmentDrafts)
      .filter(([id]) => variableSets.some(set => set.id === id && set.kind === 'environment'))) })),
}));
