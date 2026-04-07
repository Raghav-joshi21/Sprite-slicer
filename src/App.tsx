import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Scissors, Droplet, Grid3X3, Trash2, ZoomIn, ZoomOut, Image as ImageIcon } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { removeColors, findSpritesAuto, detectBackgroundColors, BoundingBox, ColorToRemove } from './lib/imageUtils';

type Tool = 'select' | 'remove-color';

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [processedImageData, setProcessedImageData] = useState<ImageData | null>(null);
  const [colorsToRemove, setColorsToRemove] = useState<ColorToRemove[]>([]);
  const [sprites, setSprites] = useState<BoundingBox[]>([]);
  const [activeTool, setActiveTool] = useState<Tool>('remove-color');
  const [zoom, setZoom] = useState(1);
  const [mergeThreshold, setMergeThreshold] = useState(10);
  const [colorTolerance, setColorTolerance] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sliceMode, setSliceMode] = useState<'auto' | 'grid'>('auto');
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(6);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setSprites([]);
        setZoom(1);
        
        // Extract initial image data
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, img.width, img.height);
          setOriginalImageData(imgData);
          setProcessedImageData(imgData);

          // Auto-detect background colors
          const detectedColors = detectBackgroundColors(imgData);
          setColorsToRemove(detectedColors);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Process image when colors to remove change or tolerance changes
  useEffect(() => {
    if (!originalImageData) return;
    
    if (colorsToRemove.length === 0) {
      setProcessedImageData(originalImageData);
      return;
    }

    // Apply the current global color tolerance to all selected colors
    const colorsWithTolerance = colorsToRemove.map(c => ({ ...c, tolerance: colorTolerance }));
    const newImageData = removeColors(originalImageData, colorsWithTolerance);
    setProcessedImageData(newImageData);
  }, [colorsToRemove, originalImageData, colorTolerance]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !processedImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = processedImageData.width;
    canvas.height = processedImageData.height;
    ctx.putImageData(processedImageData, 0, 0);

    // Draw bounding boxes
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1 / zoom; // Keep line width consistent regardless of zoom
    sprites.forEach((box) => {
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    });
  }, [processedImageData, sprites, zoom]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!originalImageData || activeTool !== 'remove-color') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const idx = (y * originalImageData.width + x) * 4;
    const r = originalImageData.data[idx];
    const g = originalImageData.data[idx + 1];
    const b = originalImageData.data[idx + 2];
    const a = originalImageData.data[idx + 3];

    if (a > 0) {
      setColorsToRemove((prev) => {
        const exists = prev.some(c => Math.abs(c.r - r) < 5 && Math.abs(c.g - g) < 5 && Math.abs(c.b - b) < 5);
        if (exists) return prev;
        return [...prev, { r, g, b, tolerance: colorTolerance }];
      });
    }
  };

  const handleAutoSlice = () => {
    if (!processedImageData) return;
    setIsProcessing(true);
    
    setTimeout(() => {
      if (sliceMode === 'auto') {
        const boxes = findSpritesAuto(processedImageData, mergeThreshold);
        setSprites(boxes);
      } else {
        // Grid Slice
        const boxes: BoundingBox[] = [];
        const cellW = Math.floor(processedImageData.width / gridCols);
        const cellH = Math.floor(processedImageData.height / gridRows);
        
        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            boxes.push({
              x: c * cellW,
              y: r * cellH,
              w: cellW,
              h: cellH
            });
          }
        }
        setSprites(boxes);
      }
      setIsProcessing(false);
    }, 50);
  };

  const handleDownloadZip = async () => {
    if (!processedImageData || sprites.length === 0) return;
    setIsProcessing(true);

    const zip = new JSZip();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      setIsProcessing(false);
      return;
    }

    for (let i = 0; i < sprites.length; i++) {
      const box = sprites[i];
      canvas.width = box.w;
      canvas.height = box.h;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Extract the specific region from processed image data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = processedImageData.width;
      tempCanvas.height = processedImageData.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(processedImageData, 0, 0);
        ctx.drawImage(tempCanvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        zip.file(`sprite_${i + 1}.png`, blob);
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, 'sprites.zip');
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Scissors className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold tracking-tight">Sprite Slicer</h1>
        </div>
        <div className="flex items-center gap-4">
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload Sprite Sheet
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          {sprites.length > 0 && (
            <button
              onClick={handleDownloadZip}
              disabled={isProcessing}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {isProcessing ? 'Zipping...' : `Download ${sprites.length} Sprites`}
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 bg-white border-r border-gray-200 p-6 flex flex-col gap-8 overflow-y-auto">
          {!image ? (
            <div className="text-center text-gray-500 mt-10">
              <ImageIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>Upload an image to start slicing.</p>
            </div>
          ) : (
            <>
              {/* Step 1: Background Removal */}
              <section>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="bg-gray-100 text-gray-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
                  Remove Background
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  Click on the image to select colors to make transparent.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Color Tolerance: {colorTolerance}</label>
                    <input 
                      type="range" 
                      min="0" max="255" 
                      value={colorTolerance} 
                      onChange={(e) => setColorTolerance(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {colorsToRemove.map((c, i) => (
                      <div key={i} className="flex items-center gap-1 bg-gray-100 rounded-full pl-2 pr-1 py-1 border border-gray-200">
                        <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }} />
                        <button 
                          onClick={() => setColorsToRemove(prev => prev.filter((_, idx) => idx !== i))}
                          className="p-1 hover:bg-gray-200 rounded-full text-gray-500 hover:text-red-500"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {colorsToRemove.length > 0 && (
                      <button 
                        onClick={() => setColorsToRemove([])}
                        className="text-xs text-red-600 hover:underline ml-2"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <hr className="border-gray-200" />

              {/* Step 2: Slice */}
              <section>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="bg-gray-100 text-gray-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
                  Slice Sprites
                </h2>
                
                <div className="space-y-4">
                  <div className="flex bg-gray-100 p-1 rounded-md">
                    <button 
                      onClick={() => setSliceMode('auto')}
                      className={`flex-1 text-xs font-medium py-1.5 rounded-sm ${sliceMode === 'auto' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Auto Detect
                    </button>
                    <button 
                      onClick={() => setSliceMode('grid')}
                      className={`flex-1 text-xs font-medium py-1.5 rounded-sm ${sliceMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Grid Slice
                    </button>
                  </div>

                  {sliceMode === 'auto' ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Merge Threshold: {mergeThreshold}px</label>
                      <p className="text-xs text-gray-500 mb-2">Distance to group disconnected parts (like sparks).</p>
                      <input 
                        type="range" 
                        min="0" max="50" 
                        value={mergeThreshold} 
                        onChange={(e) => setMergeThreshold(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Rows</label>
                        <input 
                          type="number" 
                          min="1" 
                          value={gridRows} 
                          onChange={(e) => setGridRows(Math.max(1, Number(e.target.value)))}
                          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Columns</label>
                        <input 
                          type="number" 
                          min="1" 
                          value={gridCols} 
                          onChange={(e) => setGridCols(Math.max(1, Number(e.target.value)))}
                          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleAutoSlice}
                    disabled={isProcessing}
                    className="w-full bg-gray-900 hover:bg-gray-800 text-white py-2 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Scissors className="w-4 h-4" />
                    {isProcessing ? 'Processing...' : (sliceMode === 'auto' ? 'Auto Slice' : 'Slice Grid')}
                  </button>
                  
                  {sprites.length > 0 && (
                    <p className="text-sm text-green-600 font-medium text-center">
                      Found {sprites.length} sprites!
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>

        {/* Canvas Workspace */}
        <div className="flex-1 bg-gray-100 relative overflow-hidden flex flex-col">
          {/* Toolbar */}
          {image && (
            <div className="absolute top-4 left-4 z-10 bg-white rounded-md shadow-sm border border-gray-200 flex p-1">
              <button
                onClick={() => setActiveTool('select')}
                className={`p-2 rounded-sm ${activeTool === 'select' ? 'bg-gray-100 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
                title="Select/Pan"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveTool('remove-color')}
                className={`p-2 rounded-sm ${activeTool === 'remove-color' ? 'bg-gray-100 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
                title="Remove Color (Click on image)"
              >
                <Droplet className="w-4 h-4" />
              </button>
              <div className="w-px bg-gray-200 mx-1 my-1" />
              <button onClick={() => setZoom(z => Math.min(z * 1.5, 10))} className="p-2 text-gray-600 hover:bg-gray-50 rounded-sm">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button onClick={() => setZoom(z => Math.max(z / 1.5, 0.1))} className="p-2 text-gray-600 hover:bg-gray-50 rounded-sm">
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Canvas Container */}
          <div 
            ref={containerRef}
            className="flex-1 overflow-auto flex items-center justify-center p-8 relative"
            style={{
              backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }}
          >
            {image && (
              <div 
                className="relative shadow-lg"
                style={{ 
                  transform: `scale(${zoom})`, 
                  transformOrigin: 'center center',
                  transition: 'transform 0.1s ease-out'
                }}
              >
                {/* Checkerboard background for transparency visualization */}
                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: 'conic-gradient(#eee 25%, white 25%, white 50%, #eee 50%, #eee 75%, white 75%, white)',
                    backgroundSize: '16px 16px',
                    zIndex: -1
                  }}
                />
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  className={`block ${activeTool === 'remove-color' ? 'cursor-crosshair' : 'cursor-default'}`}
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
