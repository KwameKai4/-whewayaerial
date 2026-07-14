const basePath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export const sitePath = (path = '/') => {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (basePath && (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`))) {
    return normalizedPath;
  }

  return `${basePath}${normalizedPath}`;
};

export const isRepositoryPreview = basePath !== '';
