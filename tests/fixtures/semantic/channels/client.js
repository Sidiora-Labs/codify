const bus = new EventBus();
const queue = new Queue();
const socket = new Socket();
function requestPing() { return fetch('/ping'); }
function publishJob() { return bus.emit('job.ready'); }
function publishQueue() { return queue.publish('job.ready'); }
function publishSocket() { return socket.emit('job.ready'); }
function onJob() { return bus.on('job.ready', () => {}); }
function onQueue() { return queue.subscribe('job.ready', () => {}); }
function onSocket() { return socket.on('job.ready', () => {}); }
function externalCall() { return fetch('https://example.invalid/ping'); }
