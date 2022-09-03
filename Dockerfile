FROM lucas42/lucos_navbar:latest as navbar
FROM node:18-alpine

WORKDIR /usr/src/app
COPY package* ./
RUN npm install

RUN mkdir src
COPY src src/
COPY --from=navbar lucos_navbar.js src/

ENV NODE_ENV production
ENV PORT 8019
EXPOSE $PORT

CMD [ "npm", "start" ]