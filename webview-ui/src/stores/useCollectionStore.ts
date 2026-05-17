import { create } from 'zustand';
import { Collection } from '../../../src/models/Collection';
import { Variable } from '../../../src/models/Variable';

interface CollectionState {
  collections: Collection[];
  activeCollectionId: string | null;
  selectedRequestId: string | null;
  setCollections: (collections: Collection[]) => void;
  selectCollection: (id: string | null) => void;
  selectRequest: (id: string | null) => void;
  updateCollectionVariables: (collectionId: string, variables: Variable[]) => void;
}

export const useCollectionStore = create<CollectionState>((set) => ({
  collections: [],
  activeCollectionId: null,
  selectedRequestId: null,

  setCollections: (collections) =>
    set({ collections }),

  selectCollection: (id) =>
    set({ activeCollectionId: id }),

  selectRequest: (id) =>
    set({ selectedRequestId: id }),

  updateCollectionVariables: (collectionId, variables) =>
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === collectionId ? { ...c, variables, updated: Date.now() } : c
      ),
    })),
}));
