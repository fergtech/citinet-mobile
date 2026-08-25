export const sessionStorage = {
  getItem: async (key: string) => window.localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    window.localStorage.setItem(key, value);
  },
  deleteItem: async (key: string) => {
    window.localStorage.removeItem(key);
  },
};
