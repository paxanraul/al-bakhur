const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = vec2(position.x + 1.0, 1.0 - position.y) * 0.5;
}`;
const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform sampler2D evenFrames;
uniform sampler2D oddFrames;
uniform vec2 firstTile;
uniform vec2 secondTile;
uniform float firstIsOdd;
uniform float blend;
vec2 atlasUV(vec2 tile) {
  return (tile + clamp(uv, vec2(0.002), vec2(0.998))) / vec2(8.0, 9.0);
}
void main() {
  vec2 a = atlasUV(firstTile);
  vec2 b = atlasUV(secondTile);
  if (firstIsOdd > 0.5) {
    gl_FragColor = mix(texture2D(oddFrames, a), texture2D(evenFrames, b), blend);
  } else {
    gl_FragColor = mix(texture2D(evenFrames, a), texture2D(oddFrames, b), blend);
  }
}`;

export function createPhoneTurn(images, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, powerPreference: 'low-power',
  });
  if (!gl || images.some(image => Math.max(image.width, image.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE))) return null;

  function shader(type, source) {
    const handle = gl.createShader(type);
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    return handle;
  }

  const program = gl.createProgram();
  const vertex = shader(gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  // Upload the two still images once. Subsequent frames only change tile coordinates.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  for (const [index, image] of images.entries()) {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, index ? 'oddFrames' : 'evenFrames'), index);
  }
  if (gl.getError() !== gl.NO_ERROR) return null;
  const firstTile = gl.getUniformLocation(program, 'firstTile');
  const secondTile = gl.getUniformLocation(program, 'secondTile');
  const firstIsOdd = gl.getUniformLocation(program, 'firstIsOdd');
  const blend = gl.getUniformLocation(program, 'blend');

  function draw(first, next, mix) {
    const a = Math.floor(first / 2);
    const b = Math.floor(next / 2);
    gl.uniform2f(firstTile, a % 8, Math.floor(a / 8));
    gl.uniform2f(secondTile, b % 8, Math.floor(b / 8));
    gl.uniform1f(firstIsOdd, first % 2);
    gl.uniform1f(blend, mix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { canvas, draw };
}
