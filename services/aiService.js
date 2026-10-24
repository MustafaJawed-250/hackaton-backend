const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveType = require('../models/LeaveType');
const Payroll = require('../models/Payroll');
const AiLog = require('../models/AiLog');
const { startOfDay } = require('../utils/helpers');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_headcount',
      description: 'Get current active employee headcount, optionally by department',
      parameters: {
        type: 'object',
        properties: {
          departmentId: { type: 'string', description: 'Optional department ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attendance_summary',
      description: 'Get attendance summary for a date range',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
          to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_late_comers',
      description: 'Get top late comers in a period',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results, default 5' },
          days: { type: 'number', description: 'Lookback days, default 30' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_leave_summary',
      description: 'Get leave usage summary',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string', description: 'Optional specific employee' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_leave_balance',
      description: 'Get leave balances for the current employee (self only)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payroll_summary',
      description: 'Get latest payroll totals (admin/hr only)',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'number' },
          month: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_employees',
      description: 'Search employees by name or code (hr/admin only)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
];

async function executeTool(name, args, user) {
  switch (name) {
    case 'get_headcount': {
      const filter = { employmentStatus: 'active' };
      if (args.departmentId) filter.department = args.departmentId;
      const count = await Employee.countDocuments(filter);
      return { headcount: count };
    }
    case 'get_attendance_summary': {
      const from = args.from ? startOfDay(args.from) : startOfDay(new Date(Date.now() - 30 * 86400000));
      const to = args.to ? startOfDay(args.to) : startOfDay(new Date());
      const pipeline = [
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ];
      const result = await Attendance.aggregate(pipeline);
      return { from, to, byStatus: result };
    }
    case 'get_late_comers': {
      const days = args.days || 30;
      const limit = args.limit || 5;
      const from = startOfDay(new Date(Date.now() - days * 86400000));
      const result = await Attendance.aggregate([
        { $match: { date: { $gte: from }, isLate: true } },
        { $group: { _id: '$employee', lateCount: { $sum: 1 } } },
        { $sort: { lateCount: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'employees',
            localField: '_id',
            foreignField: '_id',
            as: 'emp',
          },
        },
        { $unwind: '$emp' },
        {
          $project: {
            name: { $concat: ['$emp.firstName', ' ', '$emp.lastName'] },
            code: '$emp.employeeCode',
            lateCount: 1,
          },
        },
      ]);
      return { lateComers: result };
    }
    case 'get_leave_summary': {
      if (user.role === 'employee') {
        args.employeeId = user.employee?.toString();
      }
      const match = { status: 'approved' };
      if (args.employeeId) match.employee = args.employeeId;
      const result = await LeaveRequest.aggregate([
        { $match: match },
        { $group: { _id: '$leaveType', totalDays: { $sum: '$days' } } },
        {
          $lookup: {
            from: 'leavetypes',
            localField: '_id',
            foreignField: '_id',
            as: 'type',
          },
        },
        { $unwind: '$type' },
        { $project: { name: '$type.name', totalDays: 1 } },
      ]);
      return { leaveSummary: result };
    }
    case 'get_my_leave_balance': {
      if (!user.employee) return { error: 'No employee profile linked' };
      const types = await LeaveType.find({ isActive: true });
      const balances = [];
      for (const t of types) {
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const used = await LeaveRequest.aggregate([
          {
            $match: {
              employee: user.employee,
              leaveType: t._id,
              status: 'approved',
              startDate: { $gte: yearStart },
            },
          },
          { $group: { _id: null, total: { $sum: '$days' } } },
        ]);
        const usedDays = used[0]?.total || 0;
        balances.push({
          type: t.name,
          quota: t.annualQuota || 'Unlimited',
          used: usedDays,
          remaining: t.annualQuota ? Math.max(0, t.annualQuota - usedDays) : 'Unlimited',
        });
      }
      return { balances };
    }
    case 'get_payroll_summary': {
      if (!['admin', 'hr'].includes(user.role)) {
        return { error: 'Unauthorized' };
      }
      const q = {};
      if (args.year) q.year = args.year;
      if (args.month) q.month = args.month;
      const payroll = await Payroll.findOne(q).sort({ year: -1, month: -1 });
      if (!payroll) return { message: 'No payroll found' };
      return {
        year: payroll.year,
        month: payroll.month,
        status: payroll.status,
        totalGross: payroll.totalGross,
        totalNet: payroll.totalNet,
        totalTax: payroll.totalTax,
        employeeCount: payroll.items.length,
      };
    }
    case 'search_employees': {
      if (!['admin', 'hr'].includes(user.role)) {
        return { error: 'Unauthorized' };
      }
      const limit = Math.min(args.limit || 10, 20);
      const employees = await Employee.find({
        $text: { $search: args.query },
        employmentStatus: 'active',
      })
        .select('employeeCode firstName lastName email department')
        .populate('department', 'name')
        .limit(limit);
      return {
        results: employees.map((e) => ({
          code: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`,
          email: e.email,
          department: e.department?.name,
        })),
      };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

async function chat(user, messages) {
  const start = Date.now();
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  if (!apiKey) {
    return {
      reply: 'AI is not configured. Please set GROQ_API_KEY on the server.',
      toolsUsed: [],
    };
  }

  const systemPrompt = `You are the HCM Lite AI assistant for a company HR system.
Current user role: ${user.role}.
${user.role === 'employee' ? 'You may only answer questions about the current employee\'s own data and company policies. Never reveal other employees\' data or salaries.' : ''}
${user.role === 'hr' ? 'You have HR-level access. Do not reveal audit logs or finalize payroll.' : ''}
${user.role === 'admin' ? 'You have full company-wide access.' : ''}
Always use tools to fetch live data. Be concise, professional, and evidence-based.
If asked to apply leave, extract structured fields (leave type, start, end, reason) but do NOT submit; tell the user to confirm in the form.
Label your final answer as AI-generated when appropriate.
Respond in the same language the user uses (English or Roman Urdu).`;

  const body = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.3,
    max_tokens: 1024,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS) || 15000);

  try {
    let response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Groq API error: ${response.status} ${text}`);
    }

    let data = await response.json();
    let assistantMessage = data.choices[0].message;
    const toolsUsed = [];

    // Tool calling loop (max 3 rounds)
    let rounds = 0;
    while (assistantMessage.tool_calls && rounds < 3) {
      rounds += 1;
      const toolResults = [];
      for (const call of assistantMessage.tool_calls) {
        const name = call.function.name;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        toolsUsed.push(name);
        const result = await executeTool(name, args, user);
        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      body.messages.push(assistantMessage);
      body.messages.push(...toolResults);

      response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      data = await response.json();
      assistantMessage = data.choices[0].message;
    }

    clearTimeout(timeout);

    await AiLog.create({
      user: user.id,
      role: user.role,
      model,
      toolsCalled: toolsUsed,
      success: true,
      durationMs: Date.now() - start,
    });

    return {
      reply: assistantMessage.content || 'I could not generate a response.',
      toolsUsed,
      isAiGenerated: true,
    };
  } catch (err) {
    clearTimeout(timeout);
    await AiLog.create({
      user: user.id,
      role: user.role,
      model,
      toolsCalled: [],
      success: false,
      durationMs: Date.now() - start,
      error: err.message,
    });
    return {
      reply: 'Sorry, the AI assistant is temporarily unavailable. Please try again later.',
      toolsUsed: [],
      isAiGenerated: true,
      error: true,
    };
  }
}

module.exports = { chat, executeTool };
