import { create } from 'zustand';
import { Variable } from '../../../src/models/Variable';
import { VariableSet } from '../../../src/models/VariableSet';

interface VariableState {
  globalVariables: Variable[];
  collectionVariables: Map<string, Variable[]>;
  variableSets: VariableSet[];
  setGlobalVariables: (variables: Variable[]) => void;
  setCollectionVariables: (collectionId: string, variables: Variable[]) => void;
  setVariableSets: (sets: VariableSet[]) => void;
}

export const useVariableStore = create<VariableState>((set) => ({
  globalVariables: [],
  collectionVariables: new Map(),
  variableSets: [],

  setGlobalVariables: (globalVariables) =>
    set({ globalVariables }),

  setCollectionVariables: (collectionId, variables) =>
    set((state) => {
      const collectionVariables = new Map(state.collectionVariables);
      collectionVariables.set(collectionId, variables);
      return { collectionVariables };
    }),

  setVariableSets: (variableSets) =>
    set({ variableSets }),
}));
