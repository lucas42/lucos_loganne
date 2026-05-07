FROM node:26-alpine
ARG VERSION
ENV VERSION=$VERSION

WORKDIR /usr/src/app
COPY package* ./

RUN npm install

COPY src .

## Run the build step and then delete everything which only gets used for the build
RUN npm run build
RUN npm prune --omit=dev
RUN rm -rf client webpack*

ENV NODE_ENV production

CMD [ "npm", "start" ]