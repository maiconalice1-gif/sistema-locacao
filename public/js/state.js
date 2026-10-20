export const state = { user: null, today: '', meta: null };
export const isAdmin = () => state.user?.role === 'admin';
