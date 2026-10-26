// Main-thread proxy for the kernel worker.
export class KernelClient {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Kernel crashed'));
      this.pending.clear();
    };
    this.ready = this.call('ping');
  }

  call(op, payload = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, payload });
    });
  }

  get busy() { return this.pending.size > 0; }

  rebuild(doc, limit) { return this.call('rebuild', { doc: { features: doc.features }, limit }); }
  partMesh(doc) { return this.call('partMesh', { doc: { features: doc.features } }); }
  export(docs, format) { return this.call('export', { docs, format }); }
}
