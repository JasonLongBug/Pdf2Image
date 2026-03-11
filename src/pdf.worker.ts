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

// Import the actual worker
import 'pdfjs-dist/build/pdf.worker.mjs';
