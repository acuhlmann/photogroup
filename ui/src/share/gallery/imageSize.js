// Remember an image's natural size on its tile so the next render of the same
// photo (e.g. loading tile -> content tile) can reserve its space up front.
export function rememberImageSize(tile, img) {
    if (tile && img && img.naturalWidth && img.naturalHeight) {
        tile.imgWidth = img.naturalWidth;
        tile.imgHeight = img.naturalHeight;
    }
}

export function imageAspectRatio(tile) {
    return tile && tile.imgWidth && tile.imgHeight ? `${tile.imgWidth} / ${tile.imgHeight}` : undefined;
}
