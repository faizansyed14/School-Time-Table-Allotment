const CLASS_COL_MAP = {
  '1A': 'periods_1a', '1B': 'periods_1b',
  '2A': 'periods_2a', '2B': 'periods_2b',
  '3A': 'periods_3a', '3B': 'periods_3b',
  '4A': 'periods_4a', '4B': 'periods_4b',
  '5': 'periods_5', '6A': 'periods_6a', '6B': 'periods_6b',
  '7': 'periods_7', '8': 'periods_8',
  '9': 'periods_9', '10': 'periods_10',
};

class NetworkFlow {
  constructor() {
    this.edges = {};
    this.capacity = {};
    this.flow = {};
  }

  addEdge(u, v, cap) {
    if (!this.edges[u]) this.edges[u] = [];
    if (!this.edges[v]) this.edges[v] = [];
    
    if (!this.capacity[u]) this.capacity[u] = {};
    if (!this.capacity[v]) this.capacity[v] = {};
    
    if (!this.flow[u]) this.flow[u] = {};
    if (!this.flow[v]) this.flow[v] = {};
    
    if (!this.edges[u].includes(v)) {
      this.edges[u].push(v);
      this.edges[v].push(u);
    }
    
    this.capacity[u][v] = (this.capacity[u][v] || 0) + cap;
    if (this.capacity[v][u] === undefined) this.capacity[v][u] = 0;
    
    this.flow[u][v] = this.flow[u][v] || 0;
    this.flow[v][u] = this.flow[v][u] || 0;
  }

  dfs(u, t, visited, flowIn) {
    if (u === t) return flowIn;
    visited.add(u);

    // Minimize splits by keeping flow clustered on edges
    const neighbors = [...this.edges[u]].sort((a, b) => {
        return (this.flow[u][b] || 0) - (this.flow[u][a] || 0);
    });

    for (const v of neighbors) {
      const residual = this.capacity[u][v] - this.flow[u][v];
      if (residual > 0 && !visited.has(v)) {
        const pushed = this.dfs(v, t, visited, Math.min(flowIn, residual));
        if (pushed > 0) {
          this.flow[u][v] += pushed;
          this.flow[v][u] -= pushed;
          return pushed;
        }
      }
    }
    return 0;
  }

  solve(s, t) {
    let total = 0;
    while (true) {
      const visited = new Set();
      const pushed = this.dfs(s, t, visited, Infinity);
      if (pushed === 0) break;
      total += pushed;
    }
    return total;
  }
}

function autoGenerateAllocations({ teachers, classes, subjects }) {
  const requirements = [];
  let totalDemand = 0;

  for (const cls of classes) {
    const colName = CLASS_COL_MAP[cls.name];
    if (!colName) continue;
    for (const sub of subjects) {
      const p = sub[colName];
      if (p && p > 0) {
        requirements.push({
          class_id: cls.id,
          class_name: cls.name,
          class_level: cls.class_level,
          class_teacher_id: cls.class_teacher_id,
          subject: sub.name,
          periods_weekly: p,
          key: `${cls.id}|${sub.name}`
        });
        totalDemand += p;
      }
    }
  }

  const solver = new NetworkFlow();
  const S = 'SOURCE';
  const T = 'SINK';

  teachers.forEach(t => {
      solver.addEdge(S, `T_${t.id}`, Math.max(0, t.allotted_periods || 0));
  });

  requirements.forEach(req => {
      solver.addEdge(`R_${req.key}`, T, req.periods_weekly);
  });

  // Determines if a teacher strictly meets all proper qualifications
  const isSpecialist = (t, req) => {
      const isSpec = (t.subjects || []).includes(req.subject);
      const levelMatch = req.class_level >= (t.min_class_level || 1) && req.class_level <= (t.max_class_level || 10);
      if (req.subject === 'Diary') return (t.id === req.class_teacher_id) && isSpec;
      return isSpec && levelMatch;
  };

  // Phase 1: High Priority (Class Teachers in exactly their own class)
  teachers.forEach(t => {
      requirements.forEach(req => {
          if (t.id === req.class_teacher_id && isSpecialist(t, req)) {
              solver.addEdge(`T_${t.id}`, `R_${req.key}`, Infinity);
          }
      });
  });
  
  solver.solve(S, T);

  // Phase 2: All Other Specialists (Proper exact constraints as Python script)
  teachers.forEach(t => {
      requirements.forEach(req => {
          if (t.id === req.class_teacher_id) return; // already processed
          if (req.subject === 'Diary') return; // Strict CT only
          
          if (isSpecialist(t, req)) {
              solver.addEdge(`T_${t.id}`, `R_${req.key}`, Infinity);
          }
      });
  });

  solver.solve(S, T);

  // Phase 3: Fallback (Only run if exact distribution is mathematically impossible)
  let currentFlow = 0;
  requirements.forEach(req => {
      currentFlow += (solver.flow[`R_${req.key}`]?.[T] || 0);
  });

  if (currentFlow < totalDemand) {
      teachers.forEach(t => {
          requirements.forEach(req => {
              if (req.subject === 'Diary') return;
              if (!solver.edges[`T_${t.id}`]?.includes(`R_${req.key}`)) {
                  solver.addEdge(`T_${t.id}`, `R_${req.key}`, Infinity);
              }
          });
      });
      solver.solve(S, T);
  }

  // Extract Final Allocations
  const allocs = [];
  teachers.forEach(t => {
      const u = `T_${t.id}`;
      if (!solver.flow[u]) return;
      requirements.forEach(req => {
          const v = `R_${req.key}`;
          const f = solver.flow[u][v];
          if (f > 0) {
              allocs.push({
                  teacher_id: t.id,
                  class_id: req.class_id,
                  subject: req.subject,
                  periods_weekly: f,
                  _isFallback: !isSpecialist(t, req)
              });
          }
      });
  });

  // Verify and Report True Failures
  const warnings = [];
  const fallbacks = allocs.filter(a => a._isFallback);
  if (fallbacks.length > 0) {
      const issues = fallbacks.reduce((acc, a) => {
          const clsName = classes.find(c => c.id === a.class_id)?.name || 'Unknown';
          const k = `${a.subject} in ${clsName}`;
          if (!acc[k]) acc[k] = [];
          acc[k].push(teachers.find(t => t.id === a.teacher_id)?.name);
          return acc;
      }, {});

      Object.entries(issues).forEach(([k, forcedTeachers]) => {
          const [subName] = k.split(' in ');
          const specs = teachers.filter(t => (t.subjects || []).includes(subName));
          const specSum = specs.map(s => `${s.name}(Max:${s.allotted_periods})`).join(', ');
          warnings.push(`FORCED: ${k} assigned to ${[...new Set(forcedTeachers)].join(', ')}. Proper Specialists were FULL: ${specSum || 'None'}`);
      });
  }

  let finalFlow = allocs.reduce((sum, a) => sum + a.periods_weekly, 0);
  if (finalFlow < totalDemand) {
      warnings.push(`Incomplete: Only assigned ${finalFlow}/${totalDemand} periods! School is beyond capacity.`);
  }

  return {
      success: true,
      allocations: allocs.map(({ _isFallback, ...rest }) => rest),
      warnings
  };
}

module.exports = { autoGenerateAllocations };
