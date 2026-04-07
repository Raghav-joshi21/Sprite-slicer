export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ColorToRemove {
  r: number;
  g: number;
  b: number;
  tolerance: number;
}

export function detectBackgroundColors(imgData: ImageData): ColorToRemove[] {
  const colors: Record<string, {r: number, g: number, b: number, count: number}> = {};
  const { width, height, data } = imgData;
  
  // Sample perimeter
  const samplePixel = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx+1];
    const b = data[idx+2];
    const a = data[idx+3];
    if (a === 0) return;
    
    // Quantize slightly to group similar colors
    const key = `${Math.round(r/10)*10},${Math.round(g/10)*10},${Math.round(b/10)*10}`;
    if (!colors[key]) {
      colors[key] = { r, g, b, count: 0 };
    }
    colors[key].count++;
  };

  for (let x = 0; x < width; x++) {
    samplePixel(x, 0);
    samplePixel(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    samplePixel(0, y);
    samplePixel(width - 1, y);
  }

  // Sort by count
  const sortedColors = Object.values(colors).sort((a, b) => b.count - a.count);
  
  // Return top colors if they make up a significant portion of the perimeter
  const totalPerimeter = width * 2 + height * 2;
  const result: ColorToRemove[] = [];
  
  for (const c of sortedColors) {
    if (c.count > totalPerimeter * 0.05) { // If it makes up more than 5% of the perimeter
      result.push({ r: c.r, g: c.g, b: c.b, tolerance: 15 });
    }
  }
  
  return result.slice(0, 3); // Max 3 colors
}

export function removeColors(
  imageData: ImageData,
  colorsToRemove: ColorToRemove[]
): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) continue;

    for (const color of colorsToRemove) {
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);

      if (distance <= color.tolerance) {
        data[i + 3] = 0; // Make transparent
        data[i] = 0;
        data[i+1] = 0;
        data[i+2] = 0;
        break;
      }
    }
  }
  return new ImageData(data, imageData.width, imageData.height);
}

export function findSpritesAuto(imageData: ImageData, mergeThreshold: number = 5): BoundingBox[] {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const boxes: BoundingBox[] = [];

  // 1. Find all connected components (blobs)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha > 0 && visited[y * width + x] === 0) {
        // Start flood fill
        let minX = x, maxX = x, minY = y, maxY = y;
        const stack = [{ x, y }];
        visited[y * width + x] = 1;

        while (stack.length > 0) {
          const curr = stack.pop()!;
          if (curr.x < minX) minX = curr.x;
          if (curr.x > maxX) maxX = curr.x;
          if (curr.y < minY) minY = curr.y;
          if (curr.y > maxY) maxY = curr.y;

          // Check neighbors
          const neighbors = [
            { x: curr.x - 1, y: curr.y },
            { x: curr.x + 1, y: curr.y },
            { x: curr.x, y: curr.y - 1 },
            { x: curr.x, y: curr.y + 1 },
          ];

          for (const n of neighbors) {
            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
              const nIdx = (n.y * width + n.x) * 4;
              if (data[nIdx + 3] > 0 && visited[n.y * width + n.x] === 0) {
                visited[n.y * width + n.x] = 1;
                stack.push(n);
              }
            }
          }
        }

        boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
  }

  // 2. Merge close bounding boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const b1 = boxes[i];
        const b2 = boxes[j];

        // Check if boxes are close
        const overlapX = b1.x <= b2.x + b2.w + mergeThreshold && b2.x <= b1.x + b1.w + mergeThreshold;
        const overlapY = b1.y <= b2.y + b2.h + mergeThreshold && b2.y <= b1.y + b1.h + mergeThreshold;

        if (overlapX && overlapY) {
          // Merge b2 into b1
          const minX = Math.min(b1.x, b2.x);
          const minY = Math.min(b1.y, b2.y);
          const maxX = Math.max(b1.x + b1.w, b2.x + b2.w);
          const maxY = Math.max(b1.y + b1.h, b2.y + b2.h);

          boxes[i] = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          boxes.splice(j, 1);
          merged = true;
          break; // Restart inner loop since array changed
        }
      }
      if (merged) break; // Restart outer loop
    }
  }

  return boxes;
}
