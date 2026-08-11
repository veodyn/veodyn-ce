# The documentation site: a static Docusaurus build served by nginx.
FROM node:24-alpine AS build
WORKDIR /site
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Into html/docs, not html. Docusaurus emits a FLAT build/ tree even with
# baseUrl '/docs/' — only the URLs inside the HTML carry the prefix. Landing the
# tree one directory down is what makes those URLs resolve, and it keeps nginx
# on a plain `root` (no alias, whose interaction with try_files is a trap).
COPY --from=build /site/build /usr/share/nginx/html/docs
EXPOSE 80
