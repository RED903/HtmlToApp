/**
 * SemiLightroom - Adobe DNG (Digital Negative TIFF-EP) Raw Exporter
 * Generates valid Adobe DNG / TIFF 8-bit uncompressed RGB file buffer
 */

class DngExporter {
  /**
   * ImageData / Uint8Array RGB 픽셀 데이터를 DNG (TIFF-EP) 파일 ArrayBuffer로 인코딩
   */
  static encodeRGB(pixels, width, height) {
    const numPixels = width * height;
    const stripBytes = numPixels * 3; // RGB 3바이트
    
    // TIFF 헤더 (8바이트) + IFD 항목들 + 픽셀 데이터
    const headerSize = 8;
    const numEntries = 18; // DNG 필수 태그 수
    const ifdSize = 2 + numEntries * 12 + 4;
    
    // 추가 데이터 영역 (오프셋 포인터용: ColorMatrix, DNGVersion, BitsPerSample 등)
    const extraDataOffset = headerSize + ifdSize;
    const bitsPerSample = new Uint16Array([8, 8, 8]); // 6 바이트
    const dngVersion = new Uint8Array([1, 4, 0, 0]); // 4 바이트
    const dngBackwardVersion = new Uint8Array([1, 1, 0, 0]); // 4 바이트
    const colorMatrix1 = new Int32Array([
      10000, 10000, 0, 10000, 0, 10000,
      0, 10000, 10000, 10000, 0, 10000,
      0, 10000, 0, 10000, 10000, 10000
    ]); // 9 SRATIONAL (72 바이트)

    const extraDataSize = 6 + 4 + 4 + 72 + 32;
    const imageOffset = extraDataOffset + extraDataSize;
    const totalSize = imageOffset + stripBytes;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // 1. TIFF 헤더 (Little Endian 'II')
    view.setUint16(0, 0x4949, true); // 'II'
    view.setUint16(2, 42, true);     // TIFF Magic 42
    view.setUint32(4, 8, true);      // First IFD Offset (8)

    // 2. IFD 시작
    let offset = 8;
    view.setUint16(offset, numEntries, true);
    offset += 2;

    let extraOffset = extraDataOffset;

    // Helper: IFD 엔트리 쓰기
    const writeEntry = (tag, type, count, valueOrOffset) => {
      view.setUint16(offset, tag, true);
      view.setUint16(offset + 2, type, true);
      view.setUint32(offset + 4, count, true);
      view.setUint32(offset + 8, valueOrOffset, true);
      offset += 12;
    };

    // Type 3: SHORT, Type 4: LONG, Type 5: RATIONAL, Type 1: BYTE, Type 10: SRATIONAL
    writeEntry(0x00FE, 4, 1, 0); // NewSubfileType (0: Primary Image)
    writeEntry(0x0100, 4, 1, width); // ImageWidth
    writeEntry(0x0101, 4, 1, height); // ImageLength

    // BitsPerSample (3 shorts -> 오프셋)
    const bpsOffset = extraOffset;
    new Uint16Array(buffer, bpsOffset, 3).set(bitsPerSample);
    extraOffset += 6;
    writeEntry(0x0102, 3, 3, bpsOffset);

    writeEntry(0x0103, 3, 1, 1); // Compression (1: Uncompressed)
    writeEntry(0x0106, 3, 1, 2); // PhotometricInterpretation (2: RGB)
    writeEntry(0x0111, 4, 1, imageOffset); // StripOffsets
    writeEntry(0x0112, 3, 1, 1); // Orientation (1: Top-Left)
    writeEntry(0x0115, 3, 1, 3); // SamplesPerPixel (3)
    writeEntry(0x0116, 4, 1, height); // RowsPerStrip
    writeEntry(0x0117, 4, 1, stripBytes); // StripByteCounts
    writeEntry(0x011C, 3, 1, 1); // PlanarConfiguration (1: Chunky)

    // DNG Version (50706)
    const verOffset = extraOffset;
    new Uint8Array(buffer, verOffset, 4).set(dngVersion);
    extraOffset += 4;
    writeEntry(50706, 1, 4, verOffset);

    // DNG Backward Version (50707)
    const bVerOffset = extraOffset;
    new Uint8Array(buffer, bVerOffset, 4).set(dngBackwardVersion);
    extraOffset += 4;
    writeEntry(50707, 1, 4, bVerOffset);

    // UniqueCameraModel (50708)
    const modelStr = "SemiLightroom DNG RAW Master\0";
    const modelOffset = extraOffset;
    for (let i = 0; i < modelStr.length; i++) {
      view.setUint8(modelOffset + i, modelStr.charCodeAt(i));
    }
    extraOffset += 32;
    writeEntry(50708, 2, modelStr.length, modelOffset);

    // ColorMatrix1 (50721)
    const cmOffset = extraOffset;
    new Int32Array(buffer, cmOffset, 18).set(colorMatrix1);
    extraOffset += 72;
    writeEntry(50721, 10, 9, cmOffset);

    // CalibrationIlluminant1 (50778 - D65: 21)
    writeEntry(50778, 3, 1, 21);

    // Next IFD Offset (0)
    view.setUint32(offset, 0, true);

    // 3. 픽셀 스트립 데이터 쓰기 (RGBA -> RGB 변환)
    const rawPixels = new Uint8Array(buffer, imageOffset, stripBytes);
    let srcIdx = 0;
    let dstIdx = 0;
    for (let i = 0; i < numPixels; i++) {
      rawPixels[dstIdx++] = pixels[srcIdx];     // R
      rawPixels[dstIdx++] = pixels[srcIdx + 1]; // G
      rawPixels[dstIdx++] = pixels[srcIdx + 2]; // B
      srcIdx += 4; // Skip Alpha
    }

    return buffer;
  }
}

window.DngExporter = DngExporter;
