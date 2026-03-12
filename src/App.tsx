import React, { useState, useRef, useEffect } from 'react';

import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.js?url';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Upload, FileText, Download, Trash2, Settings2, Image as ImageIcon, Plus, CheckCircle2, AlertCircle, Loader2, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

type PdfImage = {
  url: string;
  blob: Blob;
};

type PdfJob = {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  images: PdfImage[];
  error?: string;
  errorDetails?: string;
};

export default function App() {
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [scale, setScale] = useState<number>(2);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);

  // Queue Processor
  useEffect(() => {
    const processNextJob = async () => {
      if (isProcessingRef.current) return;
      
      const nextJob = jobs.find(j => j.status === 'pending');
      if (!nextJob) return;

      console.log(`[Job ${nextJob.id}] Starting processing...`);
      isProcessingRef.current = true;
      
      setJobs(prev => prev.map(j => 
        j.id === nextJob.id ? { ...j, status: 'processing', progress: 0, error: undefined, errorDetails: undefined } : j
      ));

      try {
        console.log(`[Job ${nextJob.id}] Getting array buffer...`);
        const arrayBuffer = await nextJob.file.arrayBuffer();
        console.log(`[Job ${nextJob.id}] Array buffer loaded, size: ${arrayBuffer.byteLength}`);
        
        console.log(`[Job ${nextJob.id}] Calling getDocument...`);
        const loadingTask = pdfjsLib.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/'
        });
        
        loadingTask.onProgress = (progressData) => {
          console.log(`[Job ${nextJob.id}] Loading progress: ${progressData.loaded}/${progressData.total}`);
        };

        const pdf = await loadingTask.promise;
        console.log(`[Job ${nextJob.id}] Document loaded, pages: ${pdf.numPages}`);
        
        const totalPages = pdf.numPages;
        const newImages: PdfImage[] = [];

        for (let i = 1; i <= totalPages; i++) {
          console.log(`[Job ${nextJob.id}] Getting page ${i}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          console.log(`[Job ${nextJob.id}] Page ${i} loaded, viewport: ${viewport.width}x${viewport.height}`);

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error('无法创建 Canvas 2D 上下文');

          // 检查移动端 Canvas 尺寸限制 (iOS Safari 限制面积约 16777216)
          const MAX_CANVAS_AREA = 16777216;
          if (viewport.width * viewport.height > MAX_CANVAS_AREA) {
             throw new Error(`页面尺寸过大 (${Math.round(viewport.width)}x${Math.round(viewport.height)})，超出了浏览器内存限制。请尝试降低清晰度倍数。`);
          }

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            canvas: canvas,
            viewport: viewport,
          };

          try {
            await page.render(renderContext).promise;
          } catch (renderErr: any) {
             throw new Error(`渲染第 ${i} 页失败: ${renderErr.message || '未知渲染错误'}`);
          }
          
          // 使用 toBlob 替代 toDataURL，大幅降低内存占用，防止手机端 OOM 崩溃
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
          });

          if (!blob) throw new Error(`第 ${i} 页生成图片失败`);

          const imageUrl = URL.createObjectURL(blob);
          newImages.push({ url: imageUrl, blob });

          // 释放 Canvas 内存
          canvas.width = 0;
          canvas.height = 0;

          setJobs(prev => prev.map(j => 
            j.id === nextJob.id ? { ...j, progress: Math.round((i / totalPages) * 100) } : j
          ));
        }

        setJobs(prev => prev.map(j => 
          j.id === nextJob.id ? { ...j, status: 'completed', images: newImages, progress: 100 } : j
        ));
      } catch (error: any) {
        console.error('Error processing PDF:', error);
        const errorMsg = error?.message || error?.toString() || '未知错误';
        setJobs(prev => prev.map(j => 
          j.id === nextJob.id ? { ...j, status: 'error', error: '转换失败', errorDetails: errorMsg } : j
        ));
      } finally {
        isProcessingRef.current = false;
        // The state update above will re-trigger this useEffect to process the next job
      }
    };

    processNextJob();
  }, [jobs, scale]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const validFiles = files.filter(f => f.type === 'application/pdf');
    if (validFiles.length !== files.length) {
      alert('部分文件不是 PDF 格式，已自动过滤。');
    }

    const newJobs: PdfJob[] = validFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      file,
      status: 'pending',
      progress: 0,
      images: [],
    }));

    setJobs(prev => [...prev, ...newJobs]);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    // Re-queue all jobs to process again with new scale
    setJobs(prev => prev.map(job => {
      // 清理旧的 Blob URL 释放内存
      job.images.forEach(img => URL.revokeObjectURL(img.url));
      return {
        ...job,
        status: 'pending',
        progress: 0,
        images: [],
        error: undefined,
        errorDetails: undefined
      };
    }));
  };

  const handleDownloadJob = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.images.length === 0) return;

    const zip = new JSZip();
    const folderName = job.file.name.replace('.pdf', '') || 'pdf_images';
    const imgFolder = zip.folder(folderName);

    job.images.forEach((img, index) => {
      imgFolder?.file(`page_${index + 1}.jpg`, img.blob);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${folderName}.zip`);
  };

  const handleDownloadAll = async () => {
    const completedJobs = jobs.filter(j => j.status === 'completed' && j.images.length > 0);
    if (completedJobs.length === 0) return;

    if (completedJobs.length === 1) {
      return handleDownloadJob(completedJobs[0].id);
    }

    const zip = new JSZip();
    
    completedJobs.forEach(job => {
      const folderName = job.file.name.replace('.pdf', '');
      const imgFolder = zip.folder(folderName);
      job.images.forEach((img, index) => {
        imgFolder?.file(`page_${index + 1}.jpg`, img.blob);
      });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `批量导出的PDF图片.zip`);
  };

  const handleDownloadSingle = (img: PdfImage, index: number, jobName: string) => {
    const prefix = jobName.replace('.pdf', '');
    saveAs(img.blob, `${prefix}_page_${index + 1}.jpg`);
  };

  const handleRemoveJob = (jobId: string) => {
    setJobs(prev => {
      const jobToRemove = prev.find(j => j.id === jobId);
      if (jobToRemove) {
        jobToRemove.images.forEach(img => URL.revokeObjectURL(img.url));
      }
      return prev.filter(j => j.id !== jobId);
    });
  };

  const handleClearAll = () => {
    jobs.forEach(job => {
      job.images.forEach(img => URL.revokeObjectURL(img.url));
    });
    setJobs([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isAnyProcessing = jobs.some(j => j.status === 'processing' || j.status === 'pending');

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center p-4 sm:p-8 font-sans text-slate-900">
      <div className="w-full max-w-4xl bg-white sm:rounded-[2.5rem] rounded-3xl shadow-xl shadow-slate-200/50 flex flex-col overflow-hidden border border-slate-100">
        
        {/* Header */}
        <header className="px-6 sm:px-10 pt-10 pb-6 text-center sm:text-left border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center justify-center sm:justify-start">
                <Layers className="w-8 h-8 mr-3 text-indigo-600" />
                批量 PDF 转图片
              </h1>
              <p className="text-slate-500 mt-2 text-sm">
                支持同时上传多个文件，纯前端本地处理，保护隐私
              </p>
            </div>
            
            {/* Scale Selector */}
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
                    disabled={isAnyProcessing}
                    className={`relative px-4 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                      scale === s
                        ? 'text-indigo-700 bg-white shadow-sm ring-1 ring-slate-200/50'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                    } ${isAnyProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-6 sm:px-10 py-8 overflow-y-auto bg-slate-50/50">
          <AnimatePresence mode="wait">
            {jobs.length === 0 ? (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative border-2 border-dashed border-slate-200 rounded-[2rem] p-16 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all duration-300 bg-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-[2rem] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-100 transition-all duration-300 shadow-sm">
                  <Upload className="w-12 h-12" />
                </div>
                <h3 className="text-2xl font-semibold text-slate-800 mb-3">点击或拖拽上传 PDF</h3>
                <p className="text-slate-500 text-base text-center max-w-sm">
                  支持同时选择多个 PDF 文件进行批量转换。完全在您的浏览器中处理，速度快且安全。
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="job-list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                {/* Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200/60">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center px-4 py-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl font-semibold transition-colors"
                    >
                      <Plus className="w-5 h-5 mr-1.5" />
                      继续添加
                    </button>
                    <button
                      onClick={handleClearAll}
                      className="flex items-center px-4 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-medium transition-colors"
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      清空列表
                    </button>
                  </div>
                  
                  <button
                    onClick={handleDownloadAll}
                    disabled={!jobs.some(j => j.status === 'completed')}
                    className="flex items-center px-6 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold shadow-md shadow-indigo-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    一键下载所有完成的图片
                  </button>
                </div>

                {/* Jobs List */}
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    >
                      {/* Job Header */}
                      <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 border-b border-slate-100">
                        <div className="flex items-center space-x-4 overflow-hidden">
                          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-indigo-600" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-slate-900 truncate pr-4" title={job.file.name}>
                              {job.file.name}
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {formatFileSize(job.file.size)}
                              {job.status === 'completed' && ` · 共 ${job.images.length} 页`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end space-x-4 sm:min-w-[200px]">
                          {/* Status Badge */}
                          <div className="flex items-center">
                            {job.status === 'pending' && (
                              <span className="text-slate-500 text-sm font-medium bg-slate-100 px-3 py-1 rounded-lg">等待中...</span>
                            )}
                            {job.status === 'processing' && (
                              <div className="flex items-center text-indigo-600 text-sm font-medium bg-indigo-50 px-3 py-1 rounded-lg">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                转换中 {job.progress}%
                              </div>
                            )}
                            {job.status === 'completed' && (
                              <span className="text-emerald-600 text-sm font-medium flex items-center bg-emerald-50 px-3 py-1 rounded-lg">
                                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                                已完成
                              </span>
                            )}
                            {job.status === 'error' && (
                              <div className="flex flex-col items-end max-w-[200px] sm:max-w-[300px]">
                                <span className="text-red-600 text-sm font-medium flex items-center bg-red-50 px-3 py-1 rounded-lg" title={job.error}>
                                  <AlertCircle className="w-4 h-4 mr-1.5" />
                                  失败
                                </span>
                                {job.errorDetails && (
                                  <span className="text-xs text-red-500 mt-1.5 text-right break-all whitespace-normal w-full leading-relaxed">
                                    {job.errorDetails}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <button
                            onClick={() => handleRemoveJob(job.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors flex-shrink-0"
                            title="移除文件"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Job Body (Images Grid) */}
                      {job.status === 'completed' && job.images.length > 0 && (
                        <div className="p-4 sm:p-6">
                          <div className="flex justify-between items-center mb-4">
                            <span className="text-sm font-medium text-slate-700 flex items-center">
                              <ImageIcon className="w-4 h-4 mr-1.5 text-slate-400" />
                              预览图片
                            </span>
                            <button
                              onClick={() => handleDownloadJob(job.id)}
                              className="text-sm text-indigo-700 hover:text-indigo-800 font-semibold flex items-center bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-xl transition-colors"
                            >
                              <Download className="w-4 h-4 mr-1.5" /> 下载此文件图片
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 sm:gap-4 max-h-[280px] overflow-y-auto pr-2">
                            {job.images.map((img, index) => (
                              <div
                                key={index}
                                className="group relative bg-slate-100/50 rounded-xl overflow-hidden border border-slate-200 aspect-[3/4] shadow-sm hover:shadow-md transition-all duration-300"
                              >
                                <img src={img.url} alt={`Page ${index + 1}`} className="w-full h-full object-contain p-1.5" />
                                
                                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center backdrop-blur-[2px]">
                                  <button
                                    onClick={() => handleDownloadSingle(img, index, job.file.name)}
                                    className="bg-white text-slate-900 p-2.5 rounded-full shadow-xl transform translate-y-2 group-hover:translate-y-0 transition-all duration-200 hover:scale-110"
                                    title={`下载第 ${index + 1} 页`}
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900/70 backdrop-blur-md text-white text-[10px] font-medium px-2.5 py-0.5 rounded-full shadow-sm">
                                  {index + 1}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </main>
      </div>
    </div>
  );
}
