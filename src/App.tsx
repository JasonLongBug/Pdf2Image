import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Upload, FileText, Download, Trash2, Settings2, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scale, setScale] = useState<number>(2);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertPdfToImages = async (file: File, targetScale: number) => {
    setImages([]);
    setIsProcessing(true);
    setProgress(0);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@5.5.207/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@5.5.207/standard_fonts/',
      }).promise;
      const totalPages = pdf.numPages;
      const newImages: string[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: targetScale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          canvas: canvas,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
        const imageUrl = canvas.toDataURL('image/jpeg', 0.9);
        newImages.push(imageUrl);

        setProgress(Math.round((i / totalPages) * 100));
      }

      setImages(newImages);
    } catch (error) {
      console.error('Error processing PDF:', error);
      alert('处理PDF时出错，请检查文件是否损坏或加密。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('请选择 PDF 格式的文件');
      return;
    }

    setPdfFile(file);
    await convertPdfToImages(file, scale);
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    if (pdfFile && !isProcessing) {
      convertPdfToImages(pdfFile, newScale);
    }
  };

  const handleDownloadAll = async () => {
    if (images.length === 0) return;

    const zip = new JSZip();
    const folderName = pdfFile?.name.replace('.pdf', '') || 'pdf_images';
    const imgFolder = zip.folder(folderName);

    images.forEach((img, index) => {
      const base64Data = img.split(',')[1];
      imgFolder?.file(`page_${index + 1}.jpg`, base64Data, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${folderName}.zip`);
  };

  const handleDownloadSingle = (imgUrl: string, index: number) => {
    saveAs(imgUrl, `page_${index + 1}.jpg`);
  };

  const handleClear = () => {
    setPdfFile(null);
    setImages([]);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center p-4 sm:p-8 font-sans text-slate-900">
      <div className="w-full max-w-2xl bg-white sm:rounded-[2.5rem] rounded-3xl shadow-xl shadow-slate-200/50 flex flex-col overflow-hidden border border-slate-100">
        
        {/* Header */}
        <header className="px-8 pt-10 pb-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center justify-center sm:justify-start">
                <ImageIcon className="w-8 h-8 mr-3 text-indigo-600" />
                PDF 转图片
              </h1>
              <p className="text-slate-500 mt-2 text-sm">
                纯前端本地处理，保护您的隐私安全
              </p>
            </div>
            
            {/* Scale Selector (Compact) */}
            <div className="flex flex-col items-center sm:items-end">
              <div className="flex items-center space-x-1.5 mb-2">
                <Settings2 className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">导出清晰度</span>
              </div>
              <div className="bg-slate-100 p-1 rounded-xl flex space-x-1 border border-slate-200/60">
                {[1, 2, 3, 4].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleScaleChange(s)}
                    disabled={isProcessing}
                    className={`relative px-3 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                      scale === s
                        ? 'text-indigo-700 bg-white shadow-sm ring-1 ring-slate-200/50'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                    } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-6 sm:px-8 pb-10 overflow-y-auto">
          <AnimatePresence mode="wait">
            {!pdfFile && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative border-2 border-dashed border-slate-200 rounded-[2rem] p-12 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all duration-300 mt-4"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center mb-5 group-hover:scale-110 group-hover:bg-indigo-100 transition-all duration-300 shadow-sm">
                  <Upload className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-2">点击上传 PDF 文件</h3>
                <p className="text-slate-500 text-sm text-center max-w-xs">
                  支持多页转换。文件不会上传到任何服务器，完全在您的浏览器中处理。
                </p>
              </motion.div>
            )}

            {isProcessing && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="py-16 flex flex-col items-center justify-center"
              >
                <div className="relative w-28 h-28 mb-8">
                  {/* Background Circle */}
                  <svg className="w-full h-full text-slate-100" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" strokeWidth="8" stroke="currentColor" />
                  </svg>
                  {/* Progress Circle */}
                  <svg className="absolute top-0 left-0 w-full h-full text-indigo-600 drop-shadow-md" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                    <circle 
                      cx="50" cy="50" r="45" fill="none" strokeWidth="8" stroke="currentColor" 
                      strokeLinecap="round"
                      strokeDasharray="283" 
                      strokeDashoffset={283 - (283 * progress) / 100} 
                      className="transition-all duration-300 ease-out" 
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center flex-col">
                    <span className="text-2xl font-bold text-indigo-600 tracking-tight">{progress}%</span>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-slate-800">正在转换中...</h3>
                <p className="text-slate-500 text-sm mt-2">请耐心等待，不要关闭页面</p>
              </motion.div>
            )}

            {images.length > 0 && !isProcessing && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 mt-2"
              >
                {/* File Info Card */}
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200/60 p-4 rounded-2xl shadow-sm">
                  <div className="flex items-center space-x-4 overflow-hidden">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate pr-4">{pdfFile?.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {pdfFile ? formatFileSize(pdfFile.size) : ''} · 共 {images.length} 页
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleClear}
                    className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors flex-shrink-0"
                    title="移除文件并重新上传"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* Download All Button */}
                <button
                  onClick={handleDownloadAll}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-2xl shadow-md shadow-indigo-200 hover:shadow-lg hover:shadow-indigo-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center"
                >
                  <Download className="w-5 h-5 mr-2" />
                  打包下载全部图片
                </button>

                {/* Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6 pt-2">
                  {images.map((img, index) => (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      key={index}
                      className="group relative bg-slate-100/50 rounded-2xl overflow-hidden border border-slate-200 aspect-[3/4] shadow-sm hover:shadow-md transition-all duration-300"
                    >
                      <img src={img} alt={`Page ${index + 1}`} className="w-full h-full object-contain p-2" />
                      
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center backdrop-blur-[2px]">
                        <button
                          onClick={() => handleDownloadSingle(img, index)}
                          className="bg-white text-slate-900 p-3.5 rounded-full shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-all duration-200 hover:scale-110"
                          title={`下载第 ${index + 1} 页`}
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Page Badge */}
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-900/70 backdrop-blur-md text-white text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
                        {index + 1}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </main>
      </div>
    </div>
  );
}
