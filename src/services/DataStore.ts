export interface DataStore {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, data: T): Promise<void>;
}

