export const sitePath = (path = '/') => {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return path;

  return path.startsWith('/') ? path : `/${path}`;
};
