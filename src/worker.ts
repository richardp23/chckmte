export default {
  async fetch(_request, _env, _ctx) {
    return new Response('Hello from your Worker!')
  },
}
