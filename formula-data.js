/**
 * StudyMate AI — Formula Book data (lazy-loaded the first time the Formula Book opens).
 * ─────────────────────────────────────────────────────────────────────────
 * Standard textbook relationships only. NO exam-board or syllabus-paper claims are made:
 * `tags` are generic topic-area labels, not statements about what any board examines.
 * `rv` marks entries whose convention varies between courses/countries and needs a subject
 * teacher's review before release. Every worked example that has a calculator link is
 * re-computed through the real calculator engine by tests/formula-book.test.js.
 *
 * Entry shape (short keys keep the file small):
 *   id, s subject, t topic, st subtopic, n name, x expression, w what it calculates,
 *   y symbols  "sym|meaning|unit;sym|meaning|unit", u units note, c conditions,
 *   r rearrangements [..], ex {p problem, v {key:value}, a [expected outputs], t steps},
 *   k calculator {i:[[key,label,unit]], o:[[label,expr,unit]], ang, chk:[[expr,msg]]},
 *   tags, rv review note
 */
window.SM_FORMULAS = (function () {
  const L = [];
  function add(s, t, st, id, n, x, w, y, o) {
    o = o || {};
    L.push({ id: id, s: s, t: t, st: st, n: n, x: x, w: w,
      y: y.split(';').map(z => z.split('|')), u: o.u || '', c: o.c || '', r: o.r || [],
      ex: o.ex || null, k: o.k || null, tags: o.tags || [], rv: o.rv || '' });
  }
  const M = 'Mathematics', FM = 'Further Mathematics', P = 'Physics', C = 'Chemistry';

  // ───────────────────────── MATHEMATICS ─────────────────────────
  add(M, 'Algebra', 'Quadratics', 'm-quad', 'Quadratic formula', 'x = (−b ± √(b² − 4ac)) / 2a',
    'Solves ax² + bx + c = 0 for x.', 'x|the roots (solutions)|;a|coefficient of x²|;b|coefficient of x|;c|constant term|',
    { c: 'a ≠ 0. Real roots need b² − 4ac ≥ 0.', r: ['Sum of roots = −b/a', 'Product of roots = c/a'], tags: ['Algebra', 'Equations'],
      ex: { p: 'Solve 2x² − 5x − 3 = 0.', v: { a: 2, b: -5, c: -3 }, a: [3, -0.5], t: ['b² − 4ac = 25 + 24 = 49', 'x = (5 ± 7) / 4', 'x = 3 or x = −0.5'] },
      k: { i: [['a', 'a'], ['b', 'b'], ['c', 'c']], o: [['x₁ (+)', '(-b+sqrt(b^2-4*a*c))/(2*a)'], ['x₂ (−)', '(-b-sqrt(b^2-4*a*c))/(2*a)']] } });
  add(M, 'Algebra', 'Quadratics', 'm-disc', 'Discriminant', 'Δ = b² − 4ac',
    'Tells how many real roots ax² + bx + c = 0 has.', 'Δ|discriminant|;a|coefficient of x²|;b|coefficient of x|;c|constant term|',
    { c: 'Δ > 0: two distinct real roots. Δ = 0: one repeated root. Δ < 0: no real roots.', tags: ['Algebra'],
      ex: { p: 'Find Δ for x² − 4x + 4.', v: { a: 1, b: -4, c: 4 }, a: [0], t: ['Δ = 16 − 16 = 0', 'One repeated root (x = 2)'] },
      k: { i: [['a', 'a'], ['b', 'b'], ['c', 'c']], o: [['Δ', 'b^2-4*a*c']] } });
  add(M, 'Algebra', 'Quadratics', 'm-roots', 'Sum and product of roots', 'α + β = −b/a,   αβ = c/a',
    'Relates the roots of ax² + bx + c = 0 to its coefficients without solving it.', 'α, β|the two roots|;a|coefficient of x²|;b|coefficient of x|;c|constant term|',
    { c: 'a ≠ 0.', tags: ['Algebra'],
      ex: { p: 'For 2x² − 5x − 3 = 0, find α + β and αβ.', v: { a: 2, b: -5, c: -3 }, a: [2.5, -1.5], t: ['α + β = 5/2 = 2.5', 'αβ = −3/2 = −1.5'] },
      k: { i: [['a', 'a'], ['b', 'b'], ['c', 'c']], o: [['α + β', '-b/a'], ['αβ', 'c/a']] } });
  add(M, 'Algebra', 'Factorising', 'm-dos', 'Difference of two squares', 'a² − b² = (a − b)(a + b)',
    'Factorises an expression made of one square minus another.', 'a, b|any numbers or expressions|', { tags: ['Algebra'],
      ex: { p: 'Factorise x² − 49.', t: ['x² − 7²', '(x − 7)(x + 7)'] } });
  add(M, 'Algebra', 'Sequences and series', 'm-apn', 'Arithmetic progression: nth term', 'aₙ = a + (n − 1)d',
    'Finds the nth term of a sequence with a constant difference.', 'aₙ|nth term|;a|first term|;d|common difference|;n|term number (whole, ≥ 1)|',
    { r: ['d = (aₙ − a)/(n − 1)', 'n = (aₙ − a)/d + 1'], tags: ['Sequences'],
      ex: { p: 'First term 3, common difference 4. Find the 10th term.', v: { a: 3, d: 4, n: 10 }, a: [39], t: ['3 + 9 × 4 = 39'] },
      k: { i: [['a', 'a'], ['d', 'd'], ['n', 'n']], o: [['aₙ', 'a+(n-1)*d']] } });
  add(M, 'Algebra', 'Sequences and series', 'm-aps', 'Arithmetic progression: sum', 'Sₙ = n/2 · [2a + (n − 1)d]',
    'Adds the first n terms of an arithmetic progression.', 'Sₙ|sum of n terms|;a|first term|;d|common difference|;n|number of terms|',
    { r: ['Sₙ = n/2 · (a + l), where l is the last term'], tags: ['Sequences'],
      ex: { p: 'Sum of the first 10 terms with a = 3, d = 4.', v: { a: 3, d: 4, n: 10 }, a: [210], t: ['5 × (6 + 36) = 210'] },
      k: { i: [['a', 'a'], ['d', 'd'], ['n', 'n']], o: [['Sₙ', 'n/2*(2*a+(n-1)*d)']] } });
  add(M, 'Algebra', 'Sequences and series', 'm-gpn', 'Geometric progression: nth term', 'aₙ = a · rⁿ⁻¹',
    'Finds the nth term of a sequence with a constant ratio.', 'aₙ|nth term|;a|first term|;r|common ratio|;n|term number|',
    { tags: ['Sequences'],
      ex: { p: 'a = 2, r = 3. Find the 5th term.', v: { a: 2, r: 3, n: 5 }, a: [162], t: ['2 × 3⁴ = 162'] },
      k: { i: [['a', 'a'], ['r', 'r'], ['n', 'n']], o: [['aₙ', 'a*r^(n-1)']] } });
  add(M, 'Algebra', 'Sequences and series', 'm-gps', 'Geometric progression: sum', 'Sₙ = a(1 − rⁿ) / (1 − r)',
    'Adds the first n terms of a geometric progression.', 'Sₙ|sum of n terms|;a|first term|;r|common ratio|;n|number of terms|',
    { c: 'r ≠ 1 (if r = 1 the sum is na).', tags: ['Sequences'],
      ex: { p: 'a = 2, r = 3, n = 5.', v: { a: 2, r: 3, n: 5 }, a: [242], t: ['2(1 − 243)/(1 − 3) = 242'] },
      k: { i: [['a', 'a'], ['r', 'r'], ['n', 'n']], o: [['Sₙ', 'a*(1-r^n)/(1-r)']] } });
  add(M, 'Algebra', 'Sequences and series', 'm-gpinf', 'Sum to infinity (geometric)', 'S∞ = a / (1 − r)',
    'Gives the value a convergent geometric series approaches.', 'S∞|sum to infinity|;a|first term|;r|common ratio|',
    { c: 'Only valid when |r| < 1.', tags: ['Sequences'],
      ex: { p: 'a = 8, r = 0.5.', v: { a: 8, r: 0.5 }, a: [16], t: ['8 / 0.5 = 16'] },
      k: { i: [['a', 'a'], ['r', 'r']], o: [['S∞', 'a/(1-r)']], chk: [['abs(r)-1', 'This formula needs |r| < 1.']] } });
  add(M, 'Algebra', 'Binomial theorem', 'm-binom', 'Binomial expansion: general term', 'T(r+1) = ⁿCᵣ · aⁿ⁻ʳ · bʳ',
    'Gives the (r + 1)th term of (a + b)ⁿ.', 'T(r+1)|the (r+1)th term|;n|power (whole number)|;r|term index, 0 ≤ r ≤ n|;a, b|the two parts of the bracket|',
    { c: 'n is a non-negative integer. Terms are counted from r = 0.', tags: ['Algebra'],
      ex: { p: 'Third term of (1 + 2x)⁵ (coefficient of x²).', v: { n: 5, r: 2, a: 1, b: 2 }, a: [40], t: ['⁵C₂ = 10', '10 × 1³ × 2² = 40'] },
      k: { i: [['n', 'n'], ['r', 'r'], ['a', 'a'], ['b', 'b']], o: [['T(r+1)', 'fact(n)/(fact(r)*fact(n-r))*a^(n-r)*b^r']] } });
  add(M, 'Algebra', 'Logarithms and indices', 'm-logbase', 'Change of base', 'log_b(x) = ln x / ln b',
    'Rewrites a logarithm in any base using natural logs.', 'x|positive number|;b|base, positive and not 1|',
    { c: 'x > 0, b > 0, b ≠ 1.', tags: ['Logarithms'],
      ex: { p: 'Evaluate log₂ 8.', v: { x: 8, b: 2 }, a: [3], t: ['ln 8 / ln 2 = 3'] },
      k: { i: [['x', 'x'], ['b', 'base b']], o: [['log_b x', 'ln(x)/ln(b)']] } });
  add(M, 'Algebra', 'Logarithms and indices', 'm-loglaws', 'Laws of logarithms', 'log(xy) = log x + log y;  log(x/y) = log x − log y;  log(xⁿ) = n log x',
    'Combines or splits logarithms of products, quotients and powers.', 'x, y|positive numbers|;n|any real power|', { c: 'All arguments must be positive; same base throughout.', tags: ['Logarithms'] });
  add(M, 'Algebra', 'Logarithms and indices', 'm-indices', 'Laws of indices', 'aᵐ·aⁿ = aᵐ⁺ⁿ;  aᵐ/aⁿ = aᵐ⁻ⁿ;  (aᵐ)ⁿ = aᵐⁿ;  a⁰ = 1;  a⁻ⁿ = 1/aⁿ',
    'Simplifies powers of the same base.', 'a|base (a ≠ 0)|;m, n|powers|', { tags: ['Indices'] });
  add(M, 'Geometry', 'Coordinate geometry', 'm-dist', 'Distance between two points', 'd = √((x₂ − x₁)² + (y₂ − y₁)²)',
    'Length of the straight line joining two points.', 'd|distance|;(x₁, y₁), (x₂, y₂)|the two points|', { u: 'Same length unit as the coordinates.', tags: ['Coordinate geometry'],
      ex: { p: 'Distance between (1, 2) and (4, 6).', v: { x1: 1, y1: 2, x2: 4, y2: 6 }, a: [5], t: ['√(9 + 16) = 5'] },
      k: { i: [['x1', 'x₁'], ['y1', 'y₁'], ['x2', 'x₂'], ['y2', 'y₂']], o: [['d', 'sqrt((x2-x1)^2+(y2-y1)^2)']] } });
  add(M, 'Geometry', 'Coordinate geometry', 'm-mid', 'Midpoint', 'M = ((x₁ + x₂)/2, (y₁ + y₂)/2)',
    'Coordinates of the point halfway between two points.', 'M|midpoint|;(x₁, y₁), (x₂, y₂)|the end points|', { tags: ['Coordinate geometry'],
      ex: { p: 'Midpoint of (1, 2) and (5, 8).', v: { x1: 1, y1: 2, x2: 5, y2: 8 }, a: [3, 5], t: ['(3, 5)'] },
      k: { i: [['x1', 'x₁'], ['y1', 'y₁'], ['x2', 'x₂'], ['y2', 'y₂']], o: [['x', '(x1+x2)/2'], ['y', '(y1+y2)/2']] } });
  add(M, 'Geometry', 'Coordinate geometry', 'm-grad', 'Gradient of a line', 'm = (y₂ − y₁) / (x₂ − x₁)',
    'Steepness of the line through two points.', 'm|gradient|;(x₁, y₁), (x₂, y₂)|two points on the line|', { c: 'x₂ ≠ x₁ (otherwise the line is vertical).',
      r: ['Line: y − y₁ = m(x − x₁)', 'Parallel lines: m₁ = m₂.  Perpendicular: m₁m₂ = −1'], tags: ['Coordinate geometry'],
      ex: { p: 'Gradient through (1, 2) and (4, 8).', v: { x1: 1, y1: 2, x2: 4, y2: 8 }, a: [2], t: ['6 / 3 = 2'] },
      k: { i: [['x1', 'x₁'], ['y1', 'y₁'], ['x2', 'x₂'], ['y2', 'y₂']], o: [['m', '(y2-y1)/(x2-x1)']] } });
  add(M, 'Geometry', 'Coordinate geometry', 'm-circle', 'Equation of a circle', '(x − a)² + (y − b)² = r²',
    'Describes all points a distance r from the centre (a, b).', '(a, b)|centre|;r|radius|', { tags: ['Coordinate geometry'] });
  add(M, 'Geometry', 'Mensuration', 'm-pyth', 'Pythagoras’ theorem', 'c² = a² + b²',
    'Relates the sides of a right-angled triangle.', 'c|hypotenuse (longest side)|;a, b|the other two sides|', { c: 'Right-angled triangles only.', u: 'Same length unit throughout.',
      r: ['a = √(c² − b²)'], tags: ['Geometry'],
      ex: { p: 'Legs 3 and 4. Find the hypotenuse.', v: { a: 3, b: 4 }, a: [5], t: ['√(9 + 16) = 5'] },
      k: { i: [['a', 'a'], ['b', 'b']], o: [['c', 'sqrt(a^2+b^2)']] } });
  add(M, 'Geometry', 'Mensuration', 'm-circarea', 'Circle: area', 'A = πr²', 'Area enclosed by a circle.', 'A|area|m² (or any length²);r|radius|m',
    { tags: ['Mensuration'], ex: { p: 'r = 3.', v: { r: 3 }, a: [28.2743], t: ['π × 9 ≈ 28.27'] }, k: { i: [['r', 'r']], o: [['A', 'pi*r^2']] } });
  add(M, 'Geometry', 'Mensuration', 'm-circcirc', 'Circle: circumference', 'C = 2πr', 'Distance around a circle.', 'C|circumference|m;r|radius|m',
    { tags: ['Mensuration'], ex: { p: 'r = 3.', v: { r: 3 }, a: [18.8496], t: ['2π × 3 ≈ 18.85'] }, k: { i: [['r', 'r']], o: [['C', '2*pi*r']] } });
  add(M, 'Geometry', 'Mensuration', 'm-sphere', 'Sphere: volume and surface area', 'V = (4/3)πr³,   A = 4πr²', 'Volume and surface area of a sphere.', 'V|volume|m³;A|surface area|m²;r|radius|m',
    { tags: ['Mensuration'], ex: { p: 'r = 3.', v: { r: 3 }, a: [113.0973, 113.0973], t: ['V = 36π ≈ 113.10', 'A = 36π ≈ 113.10'] },
      k: { i: [['r', 'r']], o: [['V', '4/3*pi*r^3'], ['A', '4*pi*r^2']] } });
  add(M, 'Geometry', 'Mensuration', 'm-cone', 'Cone: volume', 'V = (1/3)πr²h', 'Volume of a cone (also (1/3) of a cylinder with the same base and height).', 'V|volume|m³;r|base radius|m;h|perpendicular height|m',
    { tags: ['Mensuration'], ex: { p: 'r = 3, h = 4.', v: { r: 3, h: 4 }, a: [37.6991], t: ['(1/3)π × 9 × 4 = 12π ≈ 37.70'] }, k: { i: [['r', 'r'], ['h', 'h']], o: [['V', '1/3*pi*r^2*h']] } });
  add(M, 'Geometry', 'Mensuration', 'm-cyl', 'Cylinder: volume and total surface area', 'V = πr²h,   A = 2πr(r + h)', 'Volume and total surface area (including both ends) of a closed cylinder.', 'V|volume|m³;A|total surface area|m²;r|radius|m;h|height|m',
    { tags: ['Mensuration'], ex: { p: 'r = 3, h = 5.', v: { r: 3, h: 5 }, a: [141.3717, 150.7964], t: ['V = 45π ≈ 141.37', 'A = 2π × 3 × 8 = 48π ≈ 150.80'] },
      k: { i: [['r', 'r'], ['h', 'h']], o: [['V', 'pi*r^2*h'], ['A', '2*pi*r*(r+h)']] } });
  add(M, 'Trigonometry', 'Identities', 'm-pythid', 'Fundamental identities', 'sin²θ + cos²θ = 1;   tan θ = sin θ / cos θ',
    'Link sine, cosine and tangent of the same angle.', 'θ|angle|degrees or radians', { c: 'tan θ undefined where cos θ = 0.', r: ['1 + tan²θ = sec²θ', '1 + cot²θ = cosec²θ'], tags: ['Trigonometry'] });
  add(M, 'Trigonometry', 'Triangles', 'm-sine', 'Sine rule', 'a / sin A = b / sin B = c / sin C',
    'Relates sides to the sines of their opposite angles in any triangle.', 'a, b, c|side lengths|;A, B, C|angles opposite a, b, c|degrees',
    { c: 'Use when you know two angles and a side, or two sides and a non-included angle (watch for the ambiguous case).', r: ['a = b sin A / sin B'], tags: ['Trigonometry'],
      ex: { p: 'A = 30°, B = 45°, b = 10. Find a.', v: { A: 30, B: 45, b: 10 }, a: [7.0711], t: ['a = 10 sin 30° / sin 45° ≈ 7.07'] },
      k: { ang: 'DEG', i: [['A', 'A', '°'], ['B', 'B', '°'], ['b', 'b']], o: [['a', 'b*sin(A)/sin(B)']] } });
  add(M, 'Trigonometry', 'Triangles', 'm-cosine', 'Cosine rule', 'a² = b² + c² − 2bc cos A',
    'Finds a side from two sides and the included angle, or an angle from three sides.', 'a|side opposite A|;b, c|the other two sides|;A|angle between b and c|degrees',
    { r: ['cos A = (b² + c² − a²) / 2bc'], tags: ['Trigonometry'],
      ex: { p: 'b = 7, c = 8, A = 60°. Find a.', v: { b: 7, c: 8, A: 60 }, a: [7.5498], t: ['a² = 49 + 64 − 56 = 57', 'a ≈ 7.55'] },
      k: { ang: 'DEG', i: [['b', 'b'], ['c', 'c'], ['A', 'A', '°']], o: [['a', 'sqrt(b^2+c^2-2*b*c*cos(A))']] } });
  add(M, 'Trigonometry', 'Triangles', 'm-triarea', 'Area of a triangle (two sides and included angle)', 'Area = ½ab sin C',
    'Area when you know two sides and the angle between them.', 'a, b|two sides|;C|angle between them|degrees', { u: 'Length² (e.g. m²).', tags: ['Trigonometry'],
      ex: { p: 'a = 6, b = 8, C = 30°.', v: { a: 6, b: 8, C: 30 }, a: [12], t: ['½ × 6 × 8 × 0.5 = 12'] },
      k: { ang: 'DEG', i: [['a', 'a'], ['b', 'b'], ['C', 'C', '°']], o: [['Area', '0.5*a*b*sin(C)']] } });
  add(M, 'Trigonometry', 'Circular measure', 'm-arc', 'Arc length and sector area (radians)', 's = rθ,   A = ½r²θ',
    'Length of an arc and area of a sector.', 's|arc length|;A|sector area|;r|radius|;θ|angle at the centre|radians',
    { c: 'θ must be in radians. In degrees: s = (θ/360)·2πr.', r: ['θ (rad) = θ (deg) × π/180'], tags: ['Trigonometry'],
      ex: { p: 'r = 5, θ = 1.2 rad.', v: { r: 5, th: 1.2 }, a: [6, 15], t: ['s = 5 × 1.2 = 6', 'A = ½ × 25 × 1.2 = 15'] },
      k: { i: [['r', 'r'], ['th', 'θ', 'rad']], o: [['s', 'r*th'], ['A', '0.5*r^2*th']] } });
  add(M, 'Trigonometry', 'Identities', 'm-double', 'Double-angle formulae', 'sin 2θ = 2 sin θ cos θ;  cos 2θ = cos²θ − sin²θ = 2cos²θ − 1 = 1 − 2sin²θ;  tan 2θ = 2tan θ / (1 − tan²θ)',
    'Express trig functions of 2θ using θ.', 'θ|angle|degrees or radians', { tags: ['Trigonometry'],
      ex: { p: 'Find sin 60° using θ = 30°.', v: { th: 30 }, a: [0.866], t: ['2 × 0.5 × 0.8660 = 0.8660'] },
      k: { ang: 'DEG', i: [['th', 'θ', '°']], o: [['sin 2θ', '2*sin(th)*cos(th)']] } });
  add(M, 'Trigonometry', 'Identities', 'm-addition', 'Addition formulae', 'sin(A ± B) = sin A cos B ± cos A sin B;  cos(A ± B) = cos A cos B ∓ sin A sin B;  tan(A ± B) = (tan A ± tan B)/(1 ∓ tan A tan B)',
    'Trig functions of a sum or difference of angles.', 'A, B|angles|', { tags: ['Trigonometry'] });
  add(M, 'Calculus', 'Differentiation', 'm-powerd', 'Power rule (differentiation)', 'd/dx (xⁿ) = nxⁿ⁻¹',
    'Gradient function of a power of x.', 'n|any real constant|;x|variable|', { tags: ['Calculus'],
      ex: { p: 'Gradient of y = x³ at x = 2.', v: { n: 3, x: 2 }, a: [12], t: ['dy/dx = 3x² = 12'] },
      k: { i: [['n', 'n'], ['x', 'x']], o: [['dy/dx', 'n*x^(n-1)']] } });
  add(M, 'Calculus', 'Differentiation', 'm-rules', 'Product, quotient and chain rules', 'Product: (uv)′ = u′v + uv′;  Quotient: (u/v)′ = (u′v − uv′)/v²;  Chain: dy/dx = dy/du · du/dx',
    'Differentiate products, quotients and composite functions.', 'u, v|functions of x|;′|derivative with respect to x|', { c: 'v ≠ 0 in the quotient rule.', tags: ['Calculus'] });
  add(M, 'Calculus', 'Differentiation', 'm-stdd', 'Standard derivatives', 'd/dx sin x = cos x;  d/dx cos x = −sin x;  d/dx tan x = sec²x;  d/dx eˣ = eˣ;  d/dx ln x = 1/x',
    'Derivatives of common functions.', 'x|variable|radians for trig functions', { c: 'Trig derivatives assume x in radians. ln x needs x > 0.', tags: ['Calculus'] });
  add(M, 'Calculus', 'Integration', 'm-powerint', 'Power rule (integration)', '∫ xⁿ dx = xⁿ⁺¹ / (n + 1) + C',
    'Antiderivative of a power of x.', 'n|constant, n ≠ −1|;C|constant of integration|', { c: 'n ≠ −1 (∫ x⁻¹ dx = ln|x| + C).', tags: ['Calculus'],
      ex: { p: 'Integrate x⁴.', t: ['x⁵/5 + C'] } });
  add(M, 'Calculus', 'Integration', 'm-trap', 'Trapezium rule', '∫ₐᵇ y dx ≈ (h/2)[y₀ + yₙ + 2(y₁ + y₂ + … + yₙ₋₁)]',
    'Approximates the area under a curve using n equal strips.', 'h|strip width = (b − a)/n|;y₀ … yₙ|y-values at equally spaced x|;n|number of strips|', { c: 'Equal strip widths.', tags: ['Calculus', 'Numerical methods'],
      ex: { p: 'y-values 1, 2, 3 with h = 1 (n = 2).', t: ['(1/2)[1 + 3 + 2(2)] = 4'] } });
  add(M, 'Calculus', 'Integration', 'm-volrev', 'Volume of revolution about the x-axis', 'V = π ∫ₐᵇ y² dx',
    'Volume formed by rotating a curve through 360° about the x-axis.', 'V|volume|;y|height of the curve|', { tags: ['Calculus'] });
  add(M, 'Statistics and Probability', 'Descriptive statistics', 'm-mean', 'Mean', 'x̄ = Σx / n', 'Average of a data set.', 'x̄|mean|same as data;Σx|sum of all values|;n|number of values|',
    { tags: ['Statistics'], ex: { p: 'Σx = 45, n = 9.', v: { sx: 45, n: 9 }, a: [5], t: ['45/9 = 5'] }, k: { i: [['sx', 'Σx'], ['n', 'n']], o: [['x̄', 'sx/n']] } });
  add(M, 'Statistics and Probability', 'Descriptive statistics', 'm-sd', 'Standard deviation (population)', 'σ = √(Σx²/n − x̄²)',
    'Typical spread of data about the mean.', 'σ|standard deviation|same as data;Σx²|sum of squared values|;n|number of values|;x̄|mean|',
    { c: 'Population form. For a sample use s = √(Σ(x − x̄)²/(n − 1)).', tags: ['Statistics'],
      ex: { p: 'Data 2, 4, 4, 4, 5, 5, 7, 9: n = 8, Σx² = 232, mean = 5.', v: { n: 8, sx2: 232, mean: 5 }, a: [2], t: ['232/8 − 25 = 4', 'σ = 2'] },
      k: { i: [['n', 'n'], ['sx2', 'Σx²'], ['mean', 'x̄']], o: [['σ', 'sqrt(sx2/n-mean^2)']] } });
  add(M, 'Statistics and Probability', 'Probability', 'm-union', 'Addition rule', 'P(A ∪ B) = P(A) + P(B) − P(A ∩ B)',
    'Probability that A or B (or both) happens.', 'P(A), P(B)|probabilities of each event|0–1;P(A ∩ B)|probability of both|0–1', { c: 'If A and B are mutually exclusive, P(A ∩ B) = 0.', tags: ['Probability'],
      ex: { p: 'P(A) = 0.5, P(B) = 0.4, P(A ∩ B) = 0.2.', v: { pa: 0.5, pb: 0.4, pab: 0.2 }, a: [0.7], t: ['0.5 + 0.4 − 0.2 = 0.7'] },
      k: { i: [['pa', 'P(A)'], ['pb', 'P(B)'], ['pab', 'P(A ∩ B)']], o: [['P(A ∪ B)', 'pa+pb-pab']] } });
  add(M, 'Statistics and Probability', 'Probability', 'm-cond', 'Conditional probability', 'P(A | B) = P(A ∩ B) / P(B)',
    'Probability of A given that B has happened.', 'P(A ∣ B)|probability of A given B|0–1;P(A ∩ B)|probability of both|;P(B)|probability of B|', { c: 'P(B) > 0.', tags: ['Probability'],
      ex: { p: 'P(A ∩ B) = 0.2, P(B) = 0.4.', v: { pab: 0.2, pb: 0.4 }, a: [0.5], t: ['0.2 / 0.4 = 0.5'] },
      k: { i: [['pab', 'P(A ∩ B)'], ['pb', 'P(B)']], o: [['P(A | B)', 'pab/pb']] } });
  add(M, 'Statistics and Probability', 'Probability', 'm-binomp', 'Binomial probability', 'P(X = r) = ⁿCᵣ pʳ (1 − p)ⁿ⁻ʳ',
    'Probability of exactly r successes in n independent trials.', 'n|number of trials|;r|number of successes|;p|probability of success on one trial|0–1',
    { c: 'Fixed n, independent trials, constant p.', tags: ['Probability', 'Distributions'],
      ex: { p: '5 fair coin tosses: exactly 2 heads.', v: { n: 5, r: 2, p: 0.5 }, a: [0.3125], t: ['10 × 0.25 × 0.125 = 0.3125'] },
      k: { i: [['n', 'n'], ['r', 'r'], ['p', 'p']], o: [['P(X = r)', 'fact(n)/(fact(r)*fact(n-r))*p^r*(1-p)^(n-r)']] } });
  add(M, 'Statistics and Probability', 'Counting', 'm-ncr', 'Combinations', 'ⁿCᵣ = n! / (r!(n − r)!)', 'Number of ways to choose r items from n when order does not matter.', 'n|total items|;r|items chosen (r ≤ n)|',
    { tags: ['Probability', 'Counting'], ex: { p: 'Choose 3 from 10.', v: { n: 10, r: 3 }, a: [120], t: ['10!/(3! 7!) = 120'] }, k: { i: [['n', 'n'], ['r', 'r']], o: [['ⁿCᵣ', 'fact(n)/(fact(r)*fact(n-r))']] } });
  add(M, 'Statistics and Probability', 'Counting', 'm-npr', 'Permutations', 'ⁿPᵣ = n! / (n − r)!', 'Number of ordered arrangements of r items from n.', 'n|total items|;r|items arranged (r ≤ n)|',
    { tags: ['Probability', 'Counting'], ex: { p: 'Arrange 2 from 5.', v: { n: 5, r: 2 }, a: [20], t: ['5!/3! = 20'] }, k: { i: [['n', 'n'], ['r', 'r']], o: [['ⁿPᵣ', 'fact(n)/fact(n-r)']] } });
  add(M, 'Statistics and Probability', 'Distributions', 'm-z', 'Standardising a normal value (z-score)', 'z = (x − μ) / σ', 'Number of standard deviations a value lies from the mean.', 'z|z-score|;x|the value|;μ|mean|;σ|standard deviation (> 0)|',
    { tags: ['Statistics', 'Distributions'], ex: { p: 'x = 70, μ = 60, σ = 5.', v: { x: 70, mu: 60, sd: 5 }, a: [2], t: ['(70 − 60)/5 = 2'] }, k: { i: [['x', 'x'], ['mu', 'μ'], ['sd', 'σ']], o: [['z', '(x-mu)/sd']] } });
  add(M, 'Number and Finance', 'Percentages', 'm-pctchg', 'Percentage change', '% change = (new − old) / old × 100', 'Increase or decrease as a percentage of the original value.', 'new|final value|;old|original value (≠ 0)|',
    { tags: ['Number'], ex: { p: 'From 80 to 100.', v: { old: 80, nw: 100 }, a: [25], t: ['20/80 × 100 = 25%'] }, k: { i: [['old', 'old'], ['nw', 'new']], o: [['% change', '(nw-old)/old*100', '%']] } });
  add(M, 'Number and Finance', 'Interest', 'm-simpint', 'Simple interest', 'I = PRT / 100', 'Interest earned on the original amount only.', 'I|interest|currency;P|principal|currency;R|rate per year|%;T|time|years',
    { tags: ['Finance'], ex: { p: 'P = 1000, R = 5%, T = 3 years.', v: { P: 1000, R: 5, T: 3 }, a: [150], t: ['1000 × 5 × 3 / 100 = 150'] }, k: { i: [['P', 'P'], ['R', 'R', '%'], ['T', 'T', 'years']], o: [['I', 'P*R*T/100']] } });
  add(M, 'Number and Finance', 'Interest', 'm-compint', 'Compound interest', 'A = P(1 + R/100)ⁿ', 'Final amount when interest is added to the principal each period.', 'A|final amount|currency;P|principal|currency;R|rate per period|%;n|number of periods|',
    { c: 'R and n must use the same period (e.g. annual rate with years).', tags: ['Finance'], ex: { p: 'P = 1000, R = 5%, n = 3.', v: { P: 1000, R: 5, n: 3 }, a: [1157.625], t: ['1000 × 1.05³ = 1157.63'] },
      k: { i: [['P', 'P'], ['R', 'R', '%'], ['n', 'n']], o: [['A', 'P*(1+R/100)^n']] } });

  // ───────────────────────── FURTHER MATHEMATICS ─────────────────────────
  add(FM, 'Complex Numbers', 'Modulus and argument', 'f-mod', 'Modulus of a complex number', '|z| = √(a² + b²)', 'Distance of z = a + bi from the origin on an Argand diagram.', '∣z∣|modulus|;a|real part|;b|imaginary part|',
    { tags: ['Complex numbers'], ex: { p: 'z = 3 + 4i.', v: { a: 3, b: 4 }, a: [5], t: ['√(9 + 16) = 5'] }, k: { i: [['a', 'a'], ['b', 'b']], o: [['|z|', 'sqrt(a^2+b^2)']] } });
  add(FM, 'Complex Numbers', 'Modulus and argument', 'f-arg', 'Argument of a complex number', 'arg z = tan⁻¹(b/a)   (adjust for quadrant)', 'Angle of z = a + bi from the positive real axis.', 'arg z|argument|degrees or radians;a|real part|;b|imaginary part|',
    { c: 'The calculator gives the principal value of tan⁻¹ only. If a < 0 add 180° (π rad) — draw the Argand diagram to choose the right quadrant.', tags: ['Complex numbers'],
      ex: { p: 'z = 3 + 4i (first quadrant).', v: { a: 3, b: 4 }, a: [53.1301], t: ['tan⁻¹(4/3) ≈ 53.13°'] }, k: { ang: 'DEG', i: [['a', 'a'], ['b', 'b']], o: [['arg z', 'atan(b/a)', '°']], chk: [['-a', 'a ≤ 0: this shortcut is only valid when a > 0 — adjust for the quadrant by hand.']] } });
  add(FM, 'Complex Numbers', 'Polar form', 'f-demoivre', 'De Moivre’s theorem', '(cos θ + i sin θ)ⁿ = cos nθ + i sin nθ', 'Raises a complex number of modulus 1 to a power; used for powers and roots.', 'θ|argument|radians or degrees;n|integer power (or rational for roots)|',
    { tags: ['Complex numbers'] });
  add(FM, 'Complex Numbers', 'Polar form', 'f-euler', 'Euler’s formula', 'e^(iθ) = cos θ + i sin θ', 'Links the exponential function with trigonometry.', 'θ|angle|radians;i|imaginary unit, i² = −1|',
    { c: 'θ in radians.', r: ['e^(iπ) + 1 = 0'], tags: ['Complex numbers'] });
  add(FM, 'Matrices', '2×2 matrices', 'f-det2', 'Determinant of a 2×2 matrix', 'det [[a, b], [c, d]] = ad − bc', 'Scale factor of area; zero means no inverse.', 'a, b, c, d|matrix entries (rows a b / c d)|',
    { tags: ['Matrices'], ex: { p: '[[3, 1], [2, 4]]', v: { a: 3, b: 1, c: 2, d: 4 }, a: [10], t: ['12 − 2 = 10'] }, k: { i: [['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd']], o: [['det', 'a*d-b*c']] } });
  add(FM, 'Matrices', '2×2 matrices', 'f-inv2', 'Inverse of a 2×2 matrix', 'A⁻¹ = 1/(ad − bc) · [[d, −b], [−c, a]]', 'Matrix that undoes A.', 'A|the matrix [[a, b], [c, d]]|;ad − bc|determinant|', { c: 'Exists only if ad − bc ≠ 0.', tags: ['Matrices'] });
  add(FM, 'Vectors', 'Scalar product', 'f-dot', 'Scalar (dot) product', 'a·b = a₁b₁ + a₂b₂ + a₃b₃ = |a||b| cos θ', 'Single number measuring how aligned two vectors are.', 'a·b|scalar product|;aᵢ, bᵢ|components|;θ|angle between the vectors|',
    { c: 'a·b = 0 ⇔ vectors are perpendicular (non-zero vectors).', tags: ['Vectors'], ex: { p: 'a = (1, 2, 3), b = (4, 5, 6).', v: { a1: 1, a2: 2, a3: 3, b1: 4, b2: 5, b3: 6 }, a: [32], t: ['4 + 10 + 18 = 32'] },
      k: { i: [['a1', 'a₁'], ['a2', 'a₂'], ['a3', 'a₃'], ['b1', 'b₁'], ['b2', 'b₂'], ['b3', 'b₃']], o: [['a·b', 'a1*b1+a2*b2+a3*b3']] } });
  add(FM, 'Vectors', 'Magnitude', 'f-mag', 'Magnitude of a 3D vector', '|a| = √(x² + y² + z²)', 'Length of a vector.', '∣a∣|magnitude|;x, y, z|components|',
    { tags: ['Vectors'], ex: { p: 'a = (2, 3, 6).', v: { x: 2, y: 3, z: 6 }, a: [7], t: ['√(4 + 9 + 36) = 7'] }, k: { i: [['x', 'x'], ['y', 'y'], ['z', 'z']], o: [['|a|', 'sqrt(x^2+y^2+z^2)']] } });
  add(FM, 'Vectors', 'Scalar product', 'f-vecang', 'Angle between two vectors', 'cos θ = a·b / (|a||b|)', 'Angle between two non-zero vectors.', 'θ|angle|degrees;a·b|scalar product|;∣a∣, ∣b∣|magnitudes|',
    { c: 'Neither vector may be zero.', tags: ['Vectors'], ex: { p: 'a = (1, 2, 3), b = (4, 5, 6).', v: { a1: 1, a2: 2, a3: 3, b1: 4, b2: 5, b3: 6 }, a: [12.9332], t: ['cos θ = 32/(√14 · √77) ≈ 0.9746', 'θ ≈ 12.93°'] },
      k: { ang: 'DEG', i: [['a1', 'a₁'], ['a2', 'a₂'], ['a3', 'a₃'], ['b1', 'b₁'], ['b2', 'b₂'], ['b3', 'b₃']], o: [['θ', 'acos((a1*b1+a2*b2+a3*b3)/(sqrt(a1^2+a2^2+a3^2)*sqrt(b1^2+b2^2+b3^2)))', '°']] } });
  add(FM, 'Vectors', 'Vector product', 'f-cross', 'Vector (cross) product', 'a × b = (a₂b₃ − a₃b₂, a₃b₁ − a₁b₃, a₁b₂ − a₂b₁),   |a × b| = |a||b| sin θ', 'Vector perpendicular to both a and b; its length is the area of the parallelogram they span.', 'a × b|vector product|;aᵢ, bᵢ|components|;θ|angle between a and b|',
    { c: 'Three-dimensional vectors; order matters (a × b = −b × a).', tags: ['Vectors'] });
  add(FM, 'Hyperbolic Functions', 'Definitions', 'f-sinh', 'sinh x', 'sinh x = (eˣ − e⁻ˣ) / 2', 'Hyperbolic sine.', 'x|any real number|', { tags: ['Hyperbolic'], ex: { p: 'x = 1.', v: { x: 1 }, a: [1.1752], t: ['(2.7183 − 0.3679)/2 ≈ 1.1752'] }, k: { i: [['x', 'x']], o: [['sinh x', '(e^x-e^(-x))/2']] } });
  add(FM, 'Hyperbolic Functions', 'Definitions', 'f-cosh', 'cosh x', 'cosh x = (eˣ + e⁻ˣ) / 2;   cosh²x − sinh²x = 1', 'Hyperbolic cosine and its basic identity.', 'x|any real number|', { tags: ['Hyperbolic'], ex: { p: 'x = 1.', v: { x: 1 }, a: [1.5431], t: ['(2.7183 + 0.3679)/2 ≈ 1.5431'] }, k: { i: [['x', 'x']], o: [['cosh x', '(e^x+e^(-x))/2']] } });
  add(FM, 'Series', 'Standard sums', 'f-sumr', 'Sum of the first n integers', 'Σr = n(n + 1) / 2', 'Adds 1 + 2 + … + n.', 'n|number of terms|', { tags: ['Series'], ex: { p: 'n = 10.', v: { n: 10 }, a: [55], t: ['10 × 11 / 2 = 55'] }, k: { i: [['n', 'n']], o: [['Σr', 'n*(n+1)/2']] } });
  add(FM, 'Series', 'Standard sums', 'f-sumr2', 'Sum of the first n squares', 'Σr² = n(n + 1)(2n + 1) / 6', 'Adds 1² + 2² + … + n².', 'n|number of terms|', { tags: ['Series'], ex: { p: 'n = 10.', v: { n: 10 }, a: [385], t: ['10 × 11 × 21 / 6 = 385'] }, k: { i: [['n', 'n']], o: [['Σr²', 'n*(n+1)*(2*n+1)/6']] } });
  add(FM, 'Series', 'Standard sums', 'f-sumr3', 'Sum of the first n cubes', 'Σr³ = [n(n + 1)/2]²', 'Adds 1³ + 2³ + … + n³.', 'n|number of terms|', { tags: ['Series'], ex: { p: 'n = 10.', v: { n: 10 }, a: [3025], t: ['55² = 3025'] }, k: { i: [['n', 'n']], o: [['Σr³', '(n*(n+1)/2)^2']] } });
  add(FM, 'Series', 'Maclaurin series', 'f-maclaurin', 'Standard Maclaurin series', 'eˣ = 1 + x + x²/2! + x³/3! + …;  sin x = x − x³/3! + x⁵/5! − …;  cos x = 1 − x²/2! + x⁴/4! − …',
    'Polynomial approximations to common functions near x = 0.', 'x|variable|radians for sin and cos', { c: 'Trig series need x in radians. These three converge for all x.', tags: ['Series'] });
  add(FM, 'Calculus', 'Integration techniques', 'f-parts', 'Integration by parts', '∫ u (dv/dx) dx = uv − ∫ v (du/dx) dx', 'Integrates a product of two functions.', 'u, v|functions of x|', { tags: ['Calculus'] });
  add(FM, 'Calculus', 'Differential equations', 'f-if', 'Integrating factor (first-order linear ODE)', 'dy/dx + P(x)y = Q(x);  I(x) = e^(∫P dx);  y·I = ∫ Q·I dx', 'Solves linear first-order differential equations.', 'P, Q|functions of x|;I|integrating factor|', { tags: ['Calculus', 'Differential equations'] });
  add(FM, 'Numerical Methods', 'Root finding', 'f-newton', 'Newton–Raphson iteration', 'xₙ₊₁ = xₙ − f(xₙ) / f′(xₙ)', 'Improves an estimate of a root of f(x) = 0.', 'xₙ|current estimate|;f(xₙ)|function value there|;f′(xₙ)|gradient there (≠ 0)|',
    { c: 'f′(xₙ) ≠ 0 and the starting value should be near the root.', tags: ['Numerical methods'], ex: { p: 'f(x) = x² − 5, x₀ = 2: f = −1, f′ = 4.', v: { xn: 2, fx: -1, dfx: 4 }, a: [2.25], t: ['2 − (−1)/4 = 2.25'] },
      k: { i: [['xn', 'xₙ'], ['fx', 'f(xₙ)'], ['dfx', 'f′(xₙ)']], o: [['xₙ₊₁', 'xn-fx/dfx']] } });

  // ───────────────────────── PHYSICS ─────────────────────────
  const GN = 'Uses g = 9.81 m/s² (change it if your course specifies another value).';
  add(P, 'Mechanics', 'Kinematics (constant acceleration)', 'p-v', 'Velocity–time equation', 'v = u + at', 'Final velocity after constant acceleration.', 'v|final velocity|m/s;u|initial velocity|m/s;a|acceleration|m/s²;t|time|s',
    { c: 'Constant acceleration in a straight line.', r: ['u = v − at', 'a = (v − u)/t', 't = (v − u)/a'], tags: ['Mechanics'], ex: { p: 'u = 5 m/s, a = 2 m/s², t = 3 s.', v: { u: 5, a: 2, t: 3 }, a: [11], t: ['5 + 6 = 11 m/s'] },
      k: { i: [['u', 'u', 'm/s'], ['a', 'a', 'm/s²'], ['t', 't', 's']], o: [['v', 'u+a*t', 'm/s']] } });
  add(P, 'Mechanics', 'Kinematics (constant acceleration)', 'p-s', 'Displacement equation', 's = ut + ½at²', 'Displacement under constant acceleration.', 's|displacement|m;u|initial velocity|m/s;a|acceleration|m/s²;t|time|s',
    { c: 'Constant acceleration in a straight line.', tags: ['Mechanics'], ex: { p: 'u = 5, a = 2, t = 3.', v: { u: 5, a: 2, t: 3 }, a: [24], t: ['15 + 9 = 24 m'] }, k: { i: [['u', 'u', 'm/s'], ['a', 'a', 'm/s²'], ['t', 't', 's']], o: [['s', 'u*t+0.5*a*t^2', 'm']] } });
  add(P, 'Mechanics', 'Kinematics (constant acceleration)', 'p-v2', 'Velocity–displacement equation', 'v² = u² + 2as', 'Links velocity and displacement without time.', 'v|final velocity|m/s;u|initial velocity|m/s;a|acceleration|m/s²;s|displacement|m',
    { c: 'Constant acceleration. v can be ±.', tags: ['Mechanics'], ex: { p: 'u = 5, a = 2, s = 12.', v: { u: 5, a: 2, s: 12 }, a: [8.544], t: ['v² = 25 + 48 = 73', 'v ≈ 8.54 m/s'] }, k: { i: [['u', 'u', 'm/s'], ['a', 'a', 'm/s²'], ['s', 's', 'm']], o: [['v', 'sqrt(u^2+2*a*s)', 'm/s']] } });
  add(P, 'Mechanics', 'Kinematics (constant acceleration)', 'p-savg', 'Displacement from average velocity', 's = ½(u + v)t', 'Displacement when both velocities are known.', 's|displacement|m;u, v|initial and final velocity|m/s;t|time|s',
    { c: 'Constant acceleration.', tags: ['Mechanics'], ex: { p: 'u = 5, v = 11, t = 3.', v: { u: 5, v: 11, t: 3 }, a: [24], t: ['½ × 16 × 3 = 24 m'] }, k: { i: [['u', 'u', 'm/s'], ['v', 'v', 'm/s'], ['t', 't', 's']], o: [['s', '0.5*(u+v)*t', 'm']] } });
  add(P, 'Mechanics', 'Dynamics', 'p-f', 'Newton’s second law', 'F = ma', 'Resultant force needed to give a mass an acceleration.', 'F|resultant force|N;m|mass|kg;a|acceleration|m/s²', { c: 'Constant mass; F is the net force.', r: ['a = F/m', 'm = F/a'], tags: ['Mechanics'],
    ex: { p: 'm = 10 kg, a = 2 m/s².', v: { m: 10, a: 2 }, a: [20], t: ['F = 20 N'] }, k: { i: [['m', 'm', 'kg'], ['a', 'a', 'm/s²']], o: [['F', 'm*a', 'N']] } });
  add(P, 'Mechanics', 'Dynamics', 'p-w', 'Weight', 'W = mg', 'Gravitational force on a mass.', 'W|weight|N;m|mass|kg;g|gravitational field strength|N/kg (= m/s²)', { c: GN, tags: ['Mechanics'],
    ex: { p: 'm = 5 kg.', v: { m: 5, g: 9.81 }, a: [49.05], t: ['5 × 9.81 = 49.05 N'] }, k: { i: [['m', 'm', 'kg'], ['g', 'g', 'N/kg']], o: [['W', 'm*g', 'N']] } });
  add(P, 'Mechanics', 'Dynamics', 'p-fric', 'Friction (limiting)', 'F = μR', 'Maximum friction force between surfaces.', 'F|friction force|N;μ|coefficient of friction|no unit;R|normal reaction|N', { c: 'Limiting (about-to-slip) or sliding friction; F ≤ μR otherwise.', tags: ['Mechanics'],
    ex: { p: 'μ = 0.3, R = 50 N.', v: { mu: 0.3, R: 50 }, a: [15], t: ['0.3 × 50 = 15 N'] }, k: { i: [['mu', 'μ'], ['R', 'R', 'N']], o: [['F', 'mu*R', 'N']] } });
  add(P, 'Mechanics', 'Momentum', 'p-mom', 'Momentum', 'p = mv', 'Quantity of motion of a moving object.', 'p|momentum|kg m/s;m|mass|kg;v|velocity|m/s', { c: 'Momentum is a vector; total momentum is conserved in a closed system.', r: ['Impulse = FΔt = Δ(mv)'], tags: ['Mechanics'],
    ex: { p: 'm = 3 kg, v = 4 m/s.', v: { m: 3, v: 4 }, a: [12], t: ['12 kg m/s'] }, k: { i: [['m', 'm', 'kg'], ['v', 'v', 'm/s']], o: [['p', 'm*v', 'kg m/s']] } });
  add(P, 'Mechanics', 'Work, energy and power', 'p-ke', 'Kinetic energy', 'KE = ½mv²', 'Energy of a moving object.', 'KE|kinetic energy|J;m|mass|kg;v|speed|m/s', { tags: ['Energy'],
    ex: { p: 'm = 2 kg, v = 3 m/s.', v: { m: 2, v: 3 }, a: [9], t: ['½ × 2 × 9 = 9 J'] }, k: { i: [['m', 'm', 'kg'], ['v', 'v', 'm/s']], o: [['KE', '0.5*m*v^2', 'J']] } });
  add(P, 'Mechanics', 'Work, energy and power', 'p-gpe', 'Gravitational potential energy', 'GPE = mgh', 'Energy gained by lifting a mass through a height.', 'GPE|potential energy|J;m|mass|kg;g|field strength|N/kg;h|height change|m', { c: 'Near Earth’s surface where g is constant. ' + GN, tags: ['Energy'],
    ex: { p: 'm = 2 kg lifted 5 m.', v: { m: 2, g: 9.81, h: 5 }, a: [98.1], t: ['2 × 9.81 × 5 = 98.1 J'] }, k: { i: [['m', 'm', 'kg'], ['g', 'g', 'N/kg'], ['h', 'h', 'm']], o: [['GPE', 'm*g*h', 'J']] } });
  add(P, 'Mechanics', 'Work, energy and power', 'p-work', 'Work done by a force', 'W = Fs cos θ', 'Energy transferred when a force moves an object.', 'W|work done|J;F|force|N;s|displacement|m;θ|angle between force and displacement|degrees', { c: 'Constant force. θ = 0° gives W = Fs.', tags: ['Energy'],
    ex: { p: 'F = 10 N, s = 5 m, θ = 60°.', v: { F: 10, s: 5, th: 60 }, a: [25], t: ['10 × 5 × 0.5 = 25 J'] }, k: { ang: 'DEG', i: [['F', 'F', 'N'], ['s', 's', 'm'], ['th', 'θ', '°']], o: [['W', 'F*s*cos(th)', 'J']] } });
  add(P, 'Mechanics', 'Work, energy and power', 'p-power', 'Power', 'P = W / t = Fv', 'Rate of doing work.', 'P|power|W (watt);W|work done|J;t|time|s;F|force|N;v|velocity|m/s', { c: 'P = Fv for constant velocity in the direction of the force.', tags: ['Energy'],
    ex: { p: '500 J in 10 s.', v: { W: 500, t: 10 }, a: [50], t: ['500/10 = 50 W'] }, k: { i: [['W', 'W', 'J'], ['t', 't', 's']], o: [['P', 'W/t', 'W']] } });
  add(P, 'Mechanics', 'Work, energy and power', 'p-eff', 'Efficiency', 'efficiency = useful output / total input × 100%', 'Fraction of input energy (or power) usefully transferred.', 'useful output|useful energy or power|J or W;total input|total energy or power|same unit', { c: 'Both quantities in the same unit.', tags: ['Energy'],
    ex: { p: '40 J useful from 50 J.', v: { out: 40, inp: 50 }, a: [80], t: ['40/50 × 100 = 80%'] }, k: { i: [['out', 'useful output'], ['inp', 'total input']], o: [['efficiency', 'out/inp*100', '%']], chk: [['out-inp-1e-12', 'Useful output cannot exceed the input.']] } });
  add(P, 'Mechanics', 'Materials', 'p-hooke', 'Hooke’s law and elastic energy', 'F = kx,   E = ½kx²', 'Force and stored energy of a stretched spring.', 'F|force|N;k|spring constant|N/m;x|extension|m;E|elastic potential energy|J', { c: 'Only below the elastic limit.', tags: ['Mechanics'],
    ex: { p: 'k = 200 N/m, x = 0.05 m.', v: { k: 200, x: 0.05 }, a: [10, 0.25], t: ['F = 10 N', 'E = ½ × 200 × 0.0025 = 0.25 J'] }, k: { i: [['k', 'k', 'N/m'], ['x', 'x', 'm']], o: [['F', 'k*x', 'N'], ['E', '0.5*k*x^2', 'J']] } });
  add(P, 'Mechanics', 'Fluids', 'p-dens', 'Density', 'ρ = m / V', 'Mass per unit volume.', 'ρ|density|kg/m³;m|mass|kg;V|volume|m³', { tags: ['Mechanics'],
    ex: { p: 'm = 500 kg, V = 0.25 m³.', v: { m: 500, V: 0.25 }, a: [2000], t: ['500/0.25 = 2000 kg/m³'] }, k: { i: [['m', 'm', 'kg'], ['V', 'V', 'm³']], o: [['ρ', 'm/V', 'kg/m³']] } });
  add(P, 'Mechanics', 'Fluids', 'p-press', 'Pressure', 'p = F / A', 'Force per unit area.', 'p|pressure|Pa (N/m²);F|force acting perpendicular to the surface|N;A|area|m²', { tags: ['Mechanics'],
    ex: { p: 'F = 100 N on 0.5 m².', v: { F: 100, A: 0.5 }, a: [200], t: ['200 Pa'] }, k: { i: [['F', 'F', 'N'], ['A', 'A', 'm²']], o: [['p', 'F/A', 'Pa']] } });
  add(P, 'Mechanics', 'Fluids', 'p-hydro', 'Pressure due to a liquid column', 'p = ρgh', 'Pressure added by depth in a fluid.', 'p|pressure from the liquid|Pa;ρ|fluid density|kg/m³;g|field strength|N/kg;h|depth|m', { c: 'Static fluid of uniform density. Add atmospheric pressure for total pressure. ' + GN, tags: ['Mechanics'],
    ex: { p: 'Water (1000 kg/m³) at 2 m depth.', v: { rho: 1000, g: 9.81, h: 2 }, a: [19620], t: ['1000 × 9.81 × 2 = 19 620 Pa'] }, k: { i: [['rho', 'ρ', 'kg/m³'], ['g', 'g', 'N/kg'], ['h', 'h', 'm']], o: [['p', 'rho*g*h', 'Pa']] } });
  add(P, 'Mechanics', 'Circular motion', 'p-circ', 'Centripetal acceleration and force', 'a = v²/r,   F = mv²/r', 'Inward acceleration and force needed for circular motion.', 'a|centripetal acceleration|m/s²;F|centripetal force|N;v|speed|m/s;r|radius|m;m|mass|kg', { c: 'Uniform circular motion.', tags: ['Mechanics'],
    ex: { p: 'v = 10 m/s, r = 5 m, m = 2 kg.', v: { v: 10, r: 5, m: 2 }, a: [20, 40], t: ['a = 100/5 = 20 m/s²', 'F = 2 × 20 = 40 N'] }, k: { i: [['v', 'v', 'm/s'], ['r', 'r', 'm'], ['m', 'm', 'kg']], o: [['a', 'v^2/r', 'm/s²'], ['F', 'm*v^2/r', 'N']] } });
  add(P, 'Mechanics', 'Circular motion', 'p-omega', 'Angular speed', 'ω = 2π/T,   v = ωr', 'Rate of rotation, and linear speed on a circle.', 'ω|angular speed|rad/s;T|period|s;v|linear speed|m/s;r|radius|m', { tags: ['Mechanics'],
    ex: { p: 'T = 4 s, r = 3 m.', v: { T: 4, r: 3 }, a: [1.5708, 4.7124], t: ['ω = π/2 ≈ 1.571 rad/s', 'v = 1.571 × 3 ≈ 4.712 m/s'] }, k: { i: [['T', 'T', 's'], ['r', 'r', 'm']], o: [['ω', '2*pi/T', 'rad/s'], ['v', '2*pi/T*r', 'm/s']] } });
  add(P, 'Mechanics', 'Projectiles', 'p-proj', 'Projectile on level ground', 'R = u² sin 2θ / g,   H = u² sin²θ / 2g,   T = 2u sin θ / g', 'Range, maximum height and time of flight of a launched object.', 'R|horizontal range|m;H|maximum height|m;T|time of flight|s;u|launch speed|m/s;θ|launch angle above horizontal|degrees;g|field strength|m/s²',
    { c: 'Launch and landing at the same height; air resistance ignored. ' + GN, tags: ['Mechanics'],
      ex: { p: 'u = 20 m/s at 30°.', v: { u: 20, th: 30, g: 9.81 }, a: [35.3126, 5.0968, 2.0387], t: ['R = 400 sin 60° / 9.81 ≈ 35.31 m', 'H = 400 × 0.25 / 19.62 ≈ 5.10 m', 'T = 40 × 0.5 / 9.81 ≈ 2.04 s'] },
      k: { ang: 'DEG', i: [['u', 'u', 'm/s'], ['th', 'θ', '°'], ['g', 'g', 'm/s²']], o: [['R', 'u^2*sin(2*th)/g', 'm'], ['H', 'u^2*sin(th)^2/(2*g)', 'm'], ['T', '2*u*sin(th)/g', 's']] } });
  add(P, 'Mechanics', 'Gravitation', 'p-grav', 'Newton’s law of gravitation', 'F = G m₁m₂ / r²', 'Attractive force between two masses.', 'F|force|N;G|gravitational constant|6.674×10⁻¹¹ N m² kg⁻²;m₁, m₂|masses|kg;r|distance between centres|m',
    { c: 'Point masses or spherical bodies (r measured centre to centre).', tags: ['Gravitation'], ex: { p: 'Earth (5.97×10²⁴ kg) and a 70 kg person at r = 6.371×10⁶ m.', v: { G: 6.674e-11, m1: 5.97e24, m2: 70, r: 6.371e6 }, a: [687.14], t: ['F ≈ 687 N'] },
      k: { i: [['G', 'G', 'N m² kg⁻²'], ['m1', 'm₁', 'kg'], ['m2', 'm₂', 'kg'], ['r', 'r', 'm']], o: [['F', 'G*m1*m2/r^2', 'N']] } });
  add(P, 'Oscillations', 'Simple harmonic motion', 'p-spring', 'Period of a mass on a spring', 'T = 2π √(m/k)', 'Time for one oscillation of a spring–mass system.', 'T|period|s;m|mass|kg;k|spring constant|N/m', { c: 'Small oscillations; massless spring.', tags: ['Oscillations'],
    ex: { p: 'm = 0.5 kg, k = 50 N/m.', v: { m: 0.5, k: 50 }, a: [0.6283], t: ['2π√0.01 ≈ 0.628 s'] }, k: { i: [['m', 'm', 'kg'], ['k', 'k', 'N/m']], o: [['T', '2*pi*sqrt(m/k)', 's']] } });
  add(P, 'Oscillations', 'Simple harmonic motion', 'p-pend', 'Period of a simple pendulum', 'T = 2π √(l/g)', 'Time for one swing of a pendulum.', 'T|period|s;l|length|m;g|field strength|m/s²', { c: 'Small angles only (about < 10°). ' + GN, tags: ['Oscillations'],
    ex: { p: 'l = 1 m.', v: { l: 1, g: 9.81 }, a: [2.0061], t: ['2π√(1/9.81) ≈ 2.006 s'] }, k: { i: [['l', 'l', 'm'], ['g', 'g', 'm/s²']], o: [['T', '2*pi*sqrt(l/g)', 's']] } });
  add(P, 'Waves and Optics', 'Waves', 'p-wave', 'Wave equation', 'v = fλ,   f = 1/T', 'Speed, frequency and wavelength of a wave.', 'v|wave speed|m/s;f|frequency|Hz;λ|wavelength|m;T|period|s', { tags: ['Waves'],
    ex: { p: 'f = 500 Hz, λ = 0.68 m.', v: { f: 500, lam: 0.68 }, a: [340], t: ['500 × 0.68 = 340 m/s'] }, k: { i: [['f', 'f', 'Hz'], ['lam', 'λ', 'm']], o: [['v', 'f*lam', 'm/s']] } });
  add(P, 'Waves and Optics', 'Refraction', 'p-snell', 'Snell’s law', 'n₁ sin θ₁ = n₂ sin θ₂', 'Bending of light at a boundary.', 'n₁, n₂|refractive indices|no unit;θ₁, θ₂|angles from the normal|degrees', { c: 'Total internal reflection when sin θ₂ would exceed 1.', tags: ['Optics'],
    ex: { p: 'Air (1.00) to glass (1.50), θ₁ = 30°.', v: { n1: 1, th1: 30, n2: 1.5 }, a: [19.4712], t: ['sin θ₂ = 0.5/1.5 = 0.3333', 'θ₂ ≈ 19.47°'] }, k: { ang: 'DEG', i: [['n1', 'n₁'], ['th1', 'θ₁', '°'], ['n2', 'n₂']], o: [['θ₂', 'asin(n1*sin(th1)/n2)', '°']] } });
  add(P, 'Waves and Optics', 'Lenses', 'p-lens', 'Thin lens equation', '1/f = 1/u + 1/v,   m = v/u', 'Relates focal length to object and image distances.', 'f|focal length|m;u|object distance|m;v|image distance|m;m|magnification (size)|no unit',
    { c: '“Real-is-positive” convention: real object/image distances and a converging lens’s f are positive.', rv: 'Sign conventions differ between courses (real-is-positive vs Cartesian). Confirm the convention taught before release.', tags: ['Optics'],
      ex: { p: 'u = 30 cm, v = 60 cm.', v: { u: 30, v: 60 }, a: [20, 2], t: ['1/f = 1/30 + 1/60 = 1/20', 'f = 20 cm, m = 2'] }, k: { i: [['u', 'u'], ['v', 'v']], o: [['f', '1/(1/u+1/v)'], ['m', 'v/u']] } });
  add(P, 'Electricity', 'DC circuits', 'p-ohm', 'Ohm’s law', 'V = IR', 'Potential difference across a resistor.', 'V|potential difference|V;I|current|A;R|resistance|Ω', { c: 'Ohmic conductors at constant temperature.', r: ['I = V/R', 'R = V/I'], tags: ['Electricity'],
    ex: { p: 'I = 2 A, R = 5 Ω.', v: { I: 2, R: 5 }, a: [10], t: ['10 V'] }, k: { i: [['I', 'I', 'A'], ['R', 'R', 'Ω']], o: [['V', 'I*R', 'V']] } });
  add(P, 'Electricity', 'DC circuits', 'p-elpower', 'Electrical power', 'P = VI = I²R = V²/R', 'Rate of energy transfer in a circuit.', 'P|power|W;V|potential difference|V;I|current|A;R|resistance|Ω', { tags: ['Electricity'],
    ex: { p: 'V = 12 V, I = 2 A.', v: { V: 12, I: 2 }, a: [24], t: ['24 W'] }, k: { i: [['V', 'V', 'V'], ['I', 'I', 'A']], o: [['P', 'V*I', 'W']] } });
  add(P, 'Electricity', 'DC circuits', 'p-series', 'Resistors in series', 'R = R₁ + R₂ + R₃ + …', 'Total resistance of resistors in series.', 'R|total resistance|Ω;Rᵢ|individual resistances|Ω', { tags: ['Electricity'],
    ex: { p: '2 Ω, 3 Ω and 5 Ω.', v: { R1: 2, R2: 3, R3: 5 }, a: [10], t: ['10 Ω'] }, k: { i: [['R1', 'R₁', 'Ω'], ['R2', 'R₂', 'Ω'], ['R3', 'R₃', 'Ω']], o: [['R', 'R1+R2+R3', 'Ω']] } });
  add(P, 'Electricity', 'DC circuits', 'p-parallel', 'Resistors in parallel', '1/R = 1/R₁ + 1/R₂ + …', 'Total resistance of resistors in parallel.', 'R|total resistance|Ω;Rᵢ|individual resistances|Ω', { c: 'Total is always less than the smallest resistor.', tags: ['Electricity'],
    ex: { p: '6 Ω and 3 Ω.', v: { R1: 6, R2: 3 }, a: [2], t: ['1/R = 1/6 + 1/3 = 1/2', 'R = 2 Ω'] }, k: { i: [['R1', 'R₁', 'Ω'], ['R2', 'R₂', 'Ω']], o: [['R', '1/(1/R1+1/R2)', 'Ω']] } });
  add(P, 'Electricity', 'DC circuits', 'p-charge', 'Charge and electrical energy', 'Q = It,   E = VIt', 'Charge passed and energy transferred.', 'Q|charge|C;I|current|A;t|time|s;E|energy|J;V|potential difference|V', { tags: ['Electricity'],
    ex: { p: 'I = 2 A, t = 30 s, V = 12 V.', v: { I: 2, t: 30, V: 12 }, a: [60, 720], t: ['Q = 60 C', 'E = 12 × 2 × 30 = 720 J'] }, k: { i: [['I', 'I', 'A'], ['t', 't', 's'], ['V', 'V', 'V']], o: [['Q', 'I*t', 'C'], ['E', 'V*I*t', 'J']] } });
  add(P, 'Electricity', 'DC circuits', 'p-resist', 'Resistivity', 'R = ρL / A', 'Resistance of a uniform wire.', 'R|resistance|Ω;ρ|resistivity|Ω m;L|length|m;A|cross-sectional area|m²', { tags: ['Electricity'],
    ex: { p: 'ρ = 1.7×10⁻⁸ Ω m, L = 10 m, A = 1×10⁻⁶ m².', v: { rho: 1.7e-8, L: 10, A: 1e-6 }, a: [0.17], t: ['0.17 Ω'] }, k: { i: [['rho', 'ρ', 'Ω m'], ['L', 'L', 'm'], ['A', 'A', 'm²']], o: [['R', 'rho*L/A', 'Ω']] } });
  add(P, 'Electricity', 'DC circuits', 'p-emf', 'EMF and internal resistance', 'ε = V + Ir', 'EMF of a cell equals terminal p.d. plus “lost volts”.', 'ε|EMF|V;V|terminal potential difference|V;I|current|A;r|internal resistance|Ω', { tags: ['Electricity'],
    ex: { p: 'V = 11.4 V, I = 2 A, r = 0.3 Ω.', v: { V: 11.4, I: 2, r: 0.3 }, a: [12], t: ['11.4 + 0.6 = 12 V'] }, k: { i: [['V', 'V', 'V'], ['I', 'I', 'A'], ['r', 'r', 'Ω']], o: [['ε', 'V+I*r', 'V']] } });
  add(P, 'Electricity', 'Electrostatics', 'p-coulomb', 'Coulomb’s law', 'F = k q₁q₂ / r²', 'Force between two point charges.', 'F|force|N;k|Coulomb constant ≈ 8.99×10⁹|N m² C⁻²;q₁, q₂|charges|C;r|separation|m', { c: 'Point charges in vacuum (air is very close). k = 1/(4πε₀).', tags: ['Electricity'],
    ex: { p: '1 μC and 2 μC, 0.1 m apart.', v: { k: 8.99e9, q1: 1e-6, q2: 2e-6, r: 0.1 }, a: [1.798], t: ['≈ 1.80 N'] }, k: { i: [['k', 'k', 'N m² C⁻²'], ['q1', 'q₁', 'C'], ['q2', 'q₂', 'C'], ['r', 'r', 'm']], o: [['F', 'k*q1*q2/r^2', 'N']] } });
  add(P, 'Electricity', 'Capacitors', 'p-cap', 'Capacitance and stored energy', 'C = Q/V,   E = ½CV²', 'Charge storage and energy of a capacitor.', 'C|capacitance|F;Q|charge|C;V|potential difference|V;E|stored energy|J', { tags: ['Electricity'],
    ex: { p: 'Q = 6 μC at 12 V.', v: { Q: 6e-6, V: 12 }, a: [5e-7, 3.6e-5], t: ['C = 5×10⁻⁷ F', 'E = ½ × 5×10⁻⁷ × 144 = 3.6×10⁻⁵ J'] }, k: { i: [['Q', 'Q', 'C'], ['V', 'V', 'V']], o: [['C', 'Q/V', 'F'], ['E', '0.5*Q*V', 'J']] } });
  add(P, 'Thermal Physics', 'Heat', 'p-heat', 'Specific heat capacity', 'Q = mcΔT', 'Energy needed to change a mass’s temperature.', 'Q|heat energy|J;m|mass|kg;c|specific heat capacity|J kg⁻¹ K⁻¹;ΔT|temperature change|K or °C', { c: 'No change of state. A change in °C equals a change in K.', tags: ['Thermal'],
    ex: { p: '0.5 kg of water (c = 4200) heated by 20 °C.', v: { m: 0.5, c: 4200, dT: 20 }, a: [42000], t: ['42 000 J'] }, k: { i: [['m', 'm', 'kg'], ['c', 'c', 'J kg⁻¹ K⁻¹'], ['dT', 'ΔT', 'K']], o: [['Q', 'm*c*dT', 'J']] } });
  add(P, 'Thermal Physics', 'Heat', 'p-latent', 'Specific latent heat', 'Q = mL', 'Energy to change state with no temperature change.', 'Q|heat energy|J;m|mass|kg;L|specific latent heat|J/kg', { tags: ['Thermal'],
    ex: { p: 'Melt 0.1 kg ice (L = 3.34×10⁵ J/kg).', v: { m: 0.1, L: 334000 }, a: [33400], t: ['33 400 J'] }, k: { i: [['m', 'm', 'kg'], ['L', 'L', 'J/kg']], o: [['Q', 'm*L', 'J']] } });
  add(P, 'Thermal Physics', 'Gases', 'p-gas', 'Ideal gas equation', 'pV = nRT', 'Relates pressure, volume, amount and temperature of an ideal gas.', 'p|pressure|Pa;V|volume|m³;n|amount of gas|mol;R|molar gas constant 8.314|J mol⁻¹ K⁻¹;T|absolute temperature|K', { c: 'T in kelvin (K = °C + 273.15). Ideal gas behaviour.', r: ['p = nRT/V', 'T = pV/(nR)'], tags: ['Thermal'],
    ex: { p: '1 mol at 300 K in 0.025 m³.', v: { n: 1, R: 8.314, T: 300, V: 0.025 }, a: [99768], t: ['p = 1 × 8.314 × 300 / 0.025 ≈ 99 768 Pa'] }, k: { i: [['n', 'n', 'mol'], ['R', 'R', 'J mol⁻¹ K⁻¹'], ['T', 'T', 'K'], ['V', 'V', 'm³']], o: [['p', 'n*R*T/V', 'Pa']] } });
  add(P, 'Thermal Physics', 'Gases', 'p-combined', 'Combined gas law', 'p₁V₁/T₁ = p₂V₂/T₂', 'Compares two states of a fixed amount of gas.', 'p|pressure|any (same unit)|;V|volume|any (same unit)|;T|temperature|K', { c: 'Fixed amount of gas; T in kelvin.', tags: ['Thermal'],
    ex: { p: 'p₁ = 100 000 Pa, V₁ = 2, T₁ = 300 K → V₂ = 1, T₂ = 400 K.', v: { p1: 100000, V1: 2, T1: 300, V2: 1, T2: 400 }, a: [266666.67], t: ['p₂ = 100 000 × 2 × 400 / (300 × 1) ≈ 266 667 Pa'] },
      k: { i: [['p1', 'p₁'], ['V1', 'V₁'], ['T1', 'T₁', 'K'], ['V2', 'V₂'], ['T2', 'T₂', 'K']], o: [['p₂', 'p1*V1*T2/(T1*V2)']] } });
  add(P, 'Thermal Physics', 'Expansion', 'p-expand', 'Linear thermal expansion', 'ΔL = αLΔT', 'Increase in length of a heated solid.', 'ΔL|change in length|m;α|coefficient of linear expansion|K⁻¹;L|original length|m;ΔT|temperature change|K', { tags: ['Thermal'],
    ex: { p: 'α = 1.2×10⁻⁵ K⁻¹, L = 2 m, ΔT = 50 K.', v: { al: 1.2e-5, L: 2, dT: 50 }, a: [0.0012], t: ['1.2 mm'] }, k: { i: [['al', 'α', 'K⁻¹'], ['L', 'L', 'm'], ['dT', 'ΔT', 'K']], o: [['ΔL', 'al*L*dT', 'm']] } });
  add(P, 'Modern Physics', 'Quantum', 'p-photon', 'Photon energy', 'E = hf = hc/λ', 'Energy carried by one photon.', 'E|photon energy|J;h|Planck constant 6.626×10⁻³⁴|J s;f|frequency|Hz;c|speed of light ≈ 3.00×10⁸|m/s;λ|wavelength|m', { tags: ['Quantum'],
    ex: { p: 'f = 5×10¹⁴ Hz.', v: { h: 6.626e-34, f: 5e14 }, a: [3.313e-19], t: ['E ≈ 3.31×10⁻¹⁹ J'] }, k: { i: [['h', 'h', 'J s'], ['f', 'f', 'Hz']], o: [['E', 'h*f', 'J']] } });
  add(P, 'Modern Physics', 'Quantum', 'p-photoelec', 'Photoelectric equation', 'hf = φ + KEmax', 'Maximum kinetic energy of an emitted photoelectron.', 'hf|photon energy|J;φ|work function|J;KEmax|maximum kinetic energy|J', { c: 'Emission only if hf ≥ φ.', tags: ['Quantum'],
    ex: { p: 'f = 1×10¹⁵ Hz, φ = 3.2×10⁻¹⁹ J.', v: { h: 6.626e-34, f: 1e15, phi: 3.2e-19 }, a: [3.426e-19], t: ['6.626×10⁻¹⁹ − 3.2×10⁻¹⁹ = 3.426×10⁻¹⁹ J'] },
      k: { i: [['h', 'h', 'J s'], ['f', 'f', 'Hz'], ['phi', 'φ', 'J']], o: [['KEmax', 'h*f-phi', 'J']], chk: [['phi-h*f', 'Photon energy is below the work function — no emission.']] } });
  add(P, 'Modern Physics', 'Quantum', 'p-debroglie', 'de Broglie wavelength', 'λ = h / p = h / mv', 'Wavelength associated with a moving particle.', 'λ|wavelength|m;h|Planck constant|J s;p|momentum|kg m/s;m|mass|kg;v|speed|m/s', { c: 'Non-relativistic speeds.', tags: ['Quantum'],
    ex: { p: 'Electron (9.109×10⁻³¹ kg) at 1×10⁶ m/s.', v: { h: 6.626e-34, m: 9.109e-31, v: 1e6 }, a: [7.274e-10], t: ['≈ 7.27×10⁻¹⁰ m'] }, k: { i: [['h', 'h', 'J s'], ['m', 'm', 'kg'], ['v', 'v', 'm/s']], o: [['λ', 'h/(m*v)', 'm']] } });
  add(P, 'Modern Physics', 'Relativity', 'p-emc', 'Mass–energy equivalence', 'E = mc²', 'Energy equivalent of a mass.', 'E|energy|J;m|mass|kg;c|speed of light ≈ 3.00×10⁸|m/s', { tags: ['Modern physics'],
    ex: { p: 'm = 1×10⁻³ kg (c = 3×10⁸ m/s).', v: { m: 0.001, c: 3e8 }, a: [9e13], t: ['9×10¹³ J'] }, k: { i: [['m', 'm', 'kg'], ['c', 'c', 'm/s']], o: [['E', 'm*c^2', 'J']] } });
  add(P, 'Modern Physics', 'Radioactivity', 'p-decay', 'Radioactive decay', 'N = N₀ e^(−λt),   t½ = ln 2 / λ', 'Number of undecayed nuclei after time t, and the half-life.', 'N|nuclei remaining|;N₀|initial nuclei|;λ|decay constant|s⁻¹;t|time|s;t½|half-life|s', { c: 'Use the same time unit for λ and t.', tags: ['Nuclear'],
    ex: { p: 'N₀ = 1000, λ = 0.1 s⁻¹, t = 5 s.', v: { N0: 1000, lam: 0.1, t: 5 }, a: [606.53, 6.9315], t: ['N = 1000 e^(−0.5) ≈ 606.5', 't½ = 0.6931/0.1 ≈ 6.93 s'] }, k: { i: [['N0', 'N₀'], ['lam', 'λ', 's⁻¹'], ['t', 't', 's']], o: [['N', 'N0*e^(-lam*t)'], ['t½', 'ln(2)/lam', 's']] } });
  add(P, 'Reference', 'Constants', 'p-const', 'Physical constants', 'g = 9.81 m/s²;  G = 6.674×10⁻¹¹ N m² kg⁻²;  c = 2.998×10⁸ m/s;  h = 6.626×10⁻³⁴ J s;  e = 1.602×10⁻¹⁹ C;  k = 8.99×10⁹ N m² C⁻²;  ε₀ = 8.854×10⁻¹² F/m;  mₑ = 9.109×10⁻³¹ kg;  mₚ = 1.673×10⁻²⁷ kg;  k_B = 1.381×10⁻²³ J/K',
    'Commonly used values, to four significant figures.', 'g|gravitational field strength at Earth’s surface|m/s²;G|gravitational constant|;c|speed of light in vacuum|;h|Planck constant|;e|elementary charge|;ε₀|permittivity of free space|;mₑ, mₚ|electron and proton mass|kg;k_B|Boltzmann constant|',
    { c: 'Use the values and precision your course or exam provides; they can differ slightly.', rv: 'Confirm rounding against the data sheet used in your course.', tags: ['Constants'] });

  // ───────────────────────── CHEMISTRY ─────────────────────────
  add(C, 'Amount of Substance', 'The mole', 'c-mole', 'Moles from mass', 'n = m / M', 'Amount of substance from mass.', 'n|amount of substance|mol;m|mass|g;M|molar mass|g/mol', { r: ['m = nM', 'M = m/n'], tags: ['Stoichiometry'],
    ex: { p: '18 g of water (M = 18 g/mol).', v: { m: 18, M: 18 }, a: [1], t: ['1 mol'] }, k: { i: [['m', 'm', 'g'], ['M', 'M', 'g/mol']], o: [['n', 'm/M', 'mol']] } });
  add(C, 'Amount of Substance', 'The mole', 'c-avog', 'Particles from moles', 'N = n × Nₐ', 'Number of particles in an amount of substance.', 'N|number of particles|;n|amount|mol;Nₐ|Avogadro constant 6.022×10²³|mol⁻¹', { tags: ['Stoichiometry'],
    ex: { p: '1.2044×10²⁴ particles — how many moles?', v: { N: 1.2044e24, NA: 6.022e23 }, a: [2], t: ['n = N/Nₐ = 2 mol'] }, k: { i: [['N', 'N'], ['NA', 'Nₐ', 'mol⁻¹']], o: [['n', 'N/NA', 'mol']] } });
  add(C, 'Amount of Substance', 'Gases', 'c-molvol', 'Gas volume from moles (molar volume)', 'V = n × Vₘ', 'Volume of a gas from its amount.', 'V|gas volume|dm³;n|amount|mol;Vₘ|molar volume|dm³/mol', { c: 'Vₘ depends on conditions: about 22.4 dm³/mol at 0 °C and 1 atm (STP); about 24 dm³/mol at 25 °C and 1 atm (RTP). Use the one your course states.',
    rv: 'Confirm which standard conditions (STP vs RTP) and values your course uses.', tags: ['Stoichiometry', 'Gases'], ex: { p: '2 mol at RTP (24 dm³/mol).', v: { n: 2, Vm: 24 }, a: [48], t: ['48 dm³'] }, k: { i: [['n', 'n', 'mol'], ['Vm', 'Vₘ', 'dm³/mol']], o: [['V', 'n*Vm', 'dm³']] } });
  add(C, 'Amount of Substance', 'Solutions', 'c-conc', 'Concentration', 'c = n / V = m / (M V)', 'Amount of solute per volume of solution.', 'c|concentration|mol/dm³;n|amount of solute|mol;V|volume of solution|dm³;m|mass of solute|g;M|molar mass|g/mol', { c: 'Volume in dm³ (1 dm³ = 1000 cm³).', tags: ['Solutions'],
    ex: { p: '4 g NaOH (M = 40) in 0.5 dm³.', v: { m: 4, M: 40, V: 0.5 }, a: [0.2], t: ['n = 0.1 mol', 'c = 0.1/0.5 = 0.2 mol/dm³'] }, k: { i: [['m', 'm', 'g'], ['M', 'M', 'g/mol'], ['V', 'V', 'dm³']], o: [['c', 'm/(M*V)', 'mol/dm³']] } });
  add(C, 'Amount of Substance', 'Solutions', 'c-dilute', 'Dilution', 'c₁V₁ = c₂V₂', 'Amount of solute is unchanged when a solution is diluted.', 'c₁, V₁|concentration and volume before|;c₂, V₂|concentration and volume after|', { c: 'Same volume unit on both sides.', tags: ['Solutions'],
    ex: { p: '25 cm³ of 2.0 mol/dm³ diluted to 0.50 mol/dm³ — final volume?', v: { c1: 2, V1: 25, c2: 0.5 }, a: [100], t: ['V₂ = 2 × 25 / 0.5 = 100 cm³'] }, k: { i: [['c1', 'c₁'], ['V1', 'V₁'], ['c2', 'c₂']], o: [['V₂', 'c1*V1/c2']] } });
  add(C, 'Amount of Substance', 'Gases', 'c-idealgas', 'Ideal gas equation', 'pV = nRT', 'Finds moles, pressure, volume or temperature of a gas.', 'p|pressure|Pa;V|volume|m³;n|amount|mol;R|gas constant 8.314|J mol⁻¹ K⁻¹;T|temperature|K', { c: 'SI units only: Pa, m³, K (1 dm³ = 10⁻³ m³; 1 atm = 101 325 Pa).', tags: ['Gases'],
    ex: { p: '101 325 Pa, 0.0224 m³, 273 K.', v: { p: 101325, V: 0.0224, R: 8.314, T: 273 }, a: [1.0], t: ['n ≈ 1.00 mol'] }, k: { i: [['p', 'p', 'Pa'], ['V', 'V', 'm³'], ['R', 'R', 'J mol⁻¹ K⁻¹'], ['T', 'T', 'K']], o: [['n', 'p*V/(R*T)', 'mol']] } });
  add(C, 'Amount of Substance', 'Yield and composition', 'c-yield', 'Percentage yield', '% yield = actual yield / theoretical yield × 100', 'How much product was obtained compared with the maximum possible.', 'actual yield|mass or moles obtained|;theoretical yield|maximum from the equation|same unit', { tags: ['Stoichiometry'],
    ex: { p: '8 g obtained, 10 g possible.', v: { act: 8, th: 10 }, a: [80], t: ['80%'] }, k: { i: [['act', 'actual yield'], ['th', 'theoretical yield']], o: [['% yield', 'act/th*100', '%']] } });
  add(C, 'Amount of Substance', 'Yield and composition', 'c-pctcomp', 'Percentage composition by mass', '% of element = (n × Aᵣ / Mᵣ) × 100', 'Mass percentage of an element in a compound.', 'n|number of atoms of the element in the formula|;Aᵣ|relative atomic mass|;Mᵣ|relative formula mass of the compound|', { tags: ['Stoichiometry'],
    ex: { p: 'Carbon in CO₂ (Aᵣ = 12, Mᵣ = 44).', v: { n: 1, Ar: 12, Mr: 44 }, a: [27.2727], t: ['12/44 × 100 ≈ 27.27%'] }, k: { i: [['n', 'n'], ['Ar', 'Aᵣ'], ['Mr', 'Mᵣ']], o: [['% by mass', 'n*Ar/Mr*100', '%']] } });
  add(C, 'Acids, Bases and Equilibria', 'pH', 'c-ph', 'pH and hydrogen-ion concentration', 'pH = −log₁₀[H⁺],   [H⁺] = 10⁻ᵖᴴ', 'Acidity of a solution.', 'pH|acidity scale|no unit;[H⁺]|hydrogen-ion concentration|mol/dm³', { c: 'Dilute aqueous solutions. For strong monoprotic acids [H⁺] ≈ acid concentration.', tags: ['Acids and bases'],
    ex: { p: '[H⁺] = 1×10⁻³ mol/dm³.', v: { H: 0.001 }, a: [3], t: ['pH = 3'] }, k: { i: [['H', '[H⁺]', 'mol/dm³']], o: [['pH', '-log(H)']] } });
  add(C, 'Acids, Bases and Equilibria', 'pH', 'c-phpoh', 'pH and pOH', 'pH + pOH = 14   (at 25 °C);   Kw = [H⁺][OH⁻] = 1.0×10⁻¹⁴', 'Relates acidity and alkalinity of water-based solutions.', 'pOH|−log₁₀[OH⁻]|;Kw|ionic product of water|mol² dm⁻⁶', { c: 'The value 14 holds at 25 °C only; Kw changes with temperature.', rv: 'Confirm temperature convention for your course.', tags: ['Acids and bases'],
    ex: { p: 'pH = 3 → pOH?', v: { pH: 3 }, a: [11], t: ['14 − 3 = 11'] }, k: { i: [['pH', 'pH']], o: [['pOH', '14-pH']] } });
  add(C, 'Acids, Bases and Equilibria', 'Weak acids', 'c-ka', 'Acid dissociation constant', 'Kₐ = [H⁺][A⁻] / [HA]', 'Strength of a weak acid HA ⇌ H⁺ + A⁻.', 'Kₐ|acid dissociation constant|mol/dm³;[H⁺], [A⁻], [HA]|equilibrium concentrations|mol/dm³', { c: 'At equilibrium; temperature-dependent.', tags: ['Equilibria'],
    ex: { p: '[H⁺] = [A⁻] = 1×10⁻³, [HA] = 0.1.', v: { H: 0.001, A: 0.001, HA: 0.1 }, a: [1e-5], t: ['Kₐ = 10⁻⁶/0.1 = 1×10⁻⁵'] }, k: { i: [['H', '[H⁺]'], ['A', '[A⁻]'], ['HA', '[HA]']], o: [['Kₐ', 'H*A/HA']] } });
  add(C, 'Acids, Bases and Equilibria', 'Equilibria', 'c-kc', 'Equilibrium constant Kc', 'For aA + bB ⇌ cC + dD:   Kc = [C]ᶜ[D]ᵈ / ([A]ᵃ[B]ᵇ)', 'Ratio of product to reactant concentrations at equilibrium.', 'Kc|equilibrium constant|units depend on the reaction;[X]|equilibrium concentration|mol/dm³;a, b, c, d|stoichiometric coefficients|', { c: 'Constant at a fixed temperature. Pure solids and liquids are left out.', tags: ['Equilibria'] });
  add(C, 'Energetics', 'Calorimetry', 'c-q', 'Heat from temperature change', 'q = mcΔT', 'Heat absorbed or released by a solution in a calorimeter.', 'q|heat|J;m|mass of solution|g;c|specific heat capacity (water 4.18)|J g⁻¹ K⁻¹;ΔT|temperature change|K', { c: 'Per mole: ΔH = −q/n (convert q to kJ). Assumes no heat loss.', tags: ['Energetics'],
    ex: { p: '100 g of water warms by 5 K.', v: { m: 100, c: 4.18, dT: 5 }, a: [2090], t: ['100 × 4.18 × 5 = 2090 J'] }, k: { i: [['m', 'm', 'g'], ['c', 'c', 'J g⁻¹ K⁻¹'], ['dT', 'ΔT', 'K']], o: [['q', 'm*c*dT', 'J']] } });
  add(C, 'Energetics', 'Enthalpy', 'c-hess', 'Enthalpy change from formation data', 'ΔH° = ΣΔH°f(products) − ΣΔH°f(reactants)', 'Reaction enthalpy from standard enthalpies of formation.', 'ΔH°|standard enthalpy change|kJ/mol;ΔH°f|standard enthalpy of formation|kJ/mol', { c: 'Multiply each value by its coefficient in the balanced equation. ΔH°f of elements in standard state = 0.', tags: ['Energetics'] });
  add(C, 'Energetics', 'Thermodynamics', 'c-gibbs', 'Gibbs free energy', 'ΔG = ΔH − TΔS', 'Predicts whether a process is feasible.', 'ΔG|Gibbs free energy change|kJ/mol;ΔH|enthalpy change|kJ/mol;T|temperature|K;ΔS|entropy change|kJ mol⁻¹ K⁻¹', { c: 'Keep energy units consistent: ΔS is often given in J mol⁻¹ K⁻¹ — divide by 1000 to use kJ. ΔG < 0: feasible.', tags: ['Energetics'],
    ex: { p: 'ΔH = −92.2 kJ/mol, ΔS = −0.1987 kJ mol⁻¹ K⁻¹, T = 298 K.', v: { dH: -92.2, T: 298, dS: -0.1987 }, a: [-32.987], t: ['−92.2 − 298(−0.1987) ≈ −32.99 kJ/mol'] }, k: { i: [['dH', 'ΔH', 'kJ/mol'], ['T', 'T', 'K'], ['dS', 'ΔS', 'kJ mol⁻¹ K⁻¹']], o: [['ΔG', 'dH-T*dS', 'kJ/mol']] } });
  add(C, 'Kinetics', 'Rate laws', 'c-rate', 'Rate equation', 'rate = k[A]ᵐ[B]ⁿ', 'How reaction rate depends on concentrations.', 'rate|reaction rate|mol dm⁻³ s⁻¹;k|rate constant|units depend on overall order;[A], [B]|concentrations|mol/dm³;m, n|orders of reaction (found by experiment)|', { c: 'Orders come from experiments, not from the balanced equation.', tags: ['Kinetics'] });
  add(C, 'Kinetics', 'Rate laws', 'c-halflife', 'First-order half-life', 't½ = ln 2 / k', 'Time for a first-order reactant to halve.', 't½|half-life|s;k|first-order rate constant|s⁻¹', { c: 'First-order reactions only.', tags: ['Kinetics'],
    ex: { p: 'k = 0.1 s⁻¹.', v: { k: 0.1 }, a: [6.9315], t: ['0.6931 / 0.1 ≈ 6.93 s'] }, k: { i: [['k', 'k', 's⁻¹']], o: [['t½', 'ln(2)/k', 's']] } });
  add(C, 'Kinetics', 'Temperature', 'c-arrh', 'Arrhenius equation', 'k = A e^(−Eₐ / RT)', 'How the rate constant depends on temperature.', 'k|rate constant|;A|pre-exponential factor|same as k;Eₐ|activation energy|J/mol;R|gas constant 8.314|J mol⁻¹ K⁻¹;T|temperature|K', { c: 'Eₐ must be in J/mol (not kJ/mol) with R = 8.314.', tags: ['Kinetics'],
    ex: { p: 'A = 1×10¹³, Eₐ = 75 000 J/mol, T = 300 K.', v: { A: 1e13, Ea: 75000, R: 8.314, T: 300 }, a: [0.8727], t: ['k ≈ 0.873'] }, k: { i: [['A', 'A'], ['Ea', 'Eₐ', 'J/mol'], ['R', 'R', 'J mol⁻¹ K⁻¹'], ['T', 'T', 'K']], o: [['k', 'A*e^(-Ea/(R*T))']] } });
  add(C, 'Electrochemistry', 'Cells', 'c-ecell', 'Standard cell potential', 'E°cell = E°(cathode) − E°(anode)', 'Voltage of a standard electrochemical cell.', 'E°cell|cell potential|V;E°(cathode)|reduction potential of the cathode half-cell|V;E°(anode)|reduction potential of the anode half-cell|V', { c: 'Use standard reduction potentials for both half-cells. E°cell > 0: feasible.', tags: ['Electrochemistry'],
    ex: { p: 'Cu²⁺/Cu (+0.34 V) cathode, Zn²⁺/Zn (−0.76 V) anode.', v: { Ec: 0.34, Ea: -0.76 }, a: [1.1], t: ['0.34 − (−0.76) = 1.10 V'] }, k: { i: [['Ec', 'E°(cathode)', 'V'], ['Ea', 'E°(anode)', 'V']], o: [['E°cell', 'Ec-Ea', 'V']] } });
  add(C, 'Electrochemistry', 'Electrolysis', 'c-faraday', 'Faraday’s law of electrolysis', 'm = M I t / (z F)', 'Mass of substance deposited or released at an electrode.', 'm|mass|g;M|molar mass|g/mol;I|current|A;t|time|s;z|electrons per ion|;F|Faraday constant 96 485|C/mol', { c: 'Constant current; 100% current efficiency.', tags: ['Electrochemistry'],
    ex: { p: 'Copper (M = 63.5, z = 2), 2 A for 1 hour.', v: { M: 63.5, I: 2, t: 3600, z: 2, F: 96485 }, a: [2.3693], t: ['m = 63.5 × 7200 / 192 970 ≈ 2.37 g'] }, k: { i: [['M', 'M', 'g/mol'], ['I', 'I', 'A'], ['t', 't', 's'], ['z', 'z'], ['F', 'F', 'C/mol']], o: [['m', 'M*I*t/(z*F)', 'g']] } });
  add(C, 'Gases', 'Diffusion', 'c-graham', 'Graham’s law of effusion', 'rate₁ / rate₂ = √(M₂ / M₁)', 'Relative rates at which two gases effuse or diffuse.', 'rate₁, rate₂|effusion rates|;M₁, M₂|molar masses|g/mol', { c: 'Same temperature and pressure.', tags: ['Gases'],
    ex: { p: 'H₂ (M = 2) vs O₂ (M = 32).', v: { M1: 2, M2: 32 }, a: [4], t: ['√(32/2) = 4: hydrogen effuses 4× faster'] }, k: { i: [['M1', 'M₁'], ['M2', 'M₂']], o: [['rate₁/rate₂', 'sqrt(M2/M1)']] } });

  return L;
})();
