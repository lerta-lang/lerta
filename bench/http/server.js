// Serves the requests of load.lerta at a free port of 127.0.0.1, which it prints first.
const http = require('http');

const handle = (request, response) => {
  switch (request.url) {
    case '/hello':
      response.end('Hello, world!');
      break;
    case '/json':
      response.end(JSON.stringify({ id: 1, name: 'lerta', tags: ['fast', 'small'] }));
      break;
    case '/echo': {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => response.end(Buffer.concat(chunks)));
      break;
    }
    default:
      response.statusCode = 404;
      response.end();
  }
};

const server = http.createServer(handle);
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
