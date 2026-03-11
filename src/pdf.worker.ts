// Polyfill for Promise.withResolvers for older browsers
if (!(Promise as any).withResolvers) {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Polyfill for Map.prototype.getOrInsertComputed (used by pdf.js)
if (!(Map.prototype as any).getOrInsertComputed) {
  (Map.prototype as any).getOrInsertComputed = function (key: any, callback: (key: any) => any) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

// Polyfill for WeakMap.prototype.getOrInsertComputed (used by pdf.js)
if (!(WeakMap.prototype as any).getOrInsertComputed) {
  (WeakMap.prototype as any).getOrInsertComputed = function (key: any, callback: (key: any) => any) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

// Import the actual worker
import 'pdfjs-dist/build/pdf.worker.mjs';
