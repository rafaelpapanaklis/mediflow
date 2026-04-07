import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { clinicId } = ctx;

    const now            = new Date();
    const today          = new Date(now); today.setHours(0,0,0,0);
    const todayEnd       = new Date(now); todayEnd.setHours(23,59,59,999);
    const firstMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstPrevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const lastPrevMonth  = new Date(now.getFullYear(), now.getMonth(), 0);
    lastPrevMonth.setHours(23,59,59,999);
    const nextSevenDays  = new Date(now); nextSevenDays.setDate(nextSevenDays.getDate()+7);

    // Batch 1 — max 7 items for TypeScript inference
    const [todayAppts, monthAppts, prevMonthAppts, monthPatients, prevMonthPatients, monthRevenue, prevMonthRevenue] =
      await Promise.all([
        prisma.appointment.findMany({
          where:   { clinicId, date:{ gte:today, lte:todayEnd } },
          include: { patient:{select:{id:true,firstName:true,lastName:true,phone:true}},
                     doctor:{select:{id:true,firstName:true,lastName:true,color:true}} },
          orderBy: { startTime:"asc" },
        }),
        prisma.appointment.count({ where:{ clinicId, date:{gte:firstMonth}, status:{not:"CANCELLED"} } }),
        prisma.appointment.count({ where:{ clinicId, date:{gte:firstPrevMonth,lte:lastPrevMonth}, status:{not:"CANCELLED"} } }),
        prisma.patient.count({ where:{ clinicId, createdAt:{gte:firstMonth} } }),
        prisma.patient.count({ where:{ clinicId, createdAt:{gte:firstPrevMonth,lte:lastPrevMonth} } }),
        prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PAID","PARTIAL"]}, updatedAt:{gte:firstMonth} }, _sum:{paid:true} }),
        prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PAID","PARTIAL"]}, updatedAt:{gte:firstPrevMonth,lte:lastPrevMonth} }, _sum:{paid:true} }),
      ]);

    // Batch 2 — remaining queries
    const [pendingInvoices, unconfirmedAppts, nextWeekAppts, lowInventory, recentPatients, doctorStats] =
      await Promise.all([
        prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PENDING","PARTIAL"]} }, _sum:{balance:true}, _count:true }),
        prisma.appointment.count({ where:{ clinicId, date:{gte:today}, status:"PENDING" } }),
        prisma.appointment.findMany({
          where:   { clinicId, date:{gt:todayEnd,lte:nextSevenDays}, status:{not:"CANCELLED"} },
          include: { patient:{select:{firstName:true,lastName:true}}, doctor:{select:{firstName:true,lastName:true,color:true}} },
          orderBy: [{date:"asc"},{startTime:"asc"}], take:20,
        }),
        prisma.inventoryItem.findMany({
          where:   { clinicId }, orderBy:{quantity:"asc"}, take:10,
          select:  {id:true,name:true,quantity:true,minQuantity:true,unit:true,emoji:true},
        }),
        prisma.patient.findMany({
          where:   { clinicId }, orderBy:{createdAt:"desc"}, take:5,
          select:  {id:true,firstName:true,lastName:true,createdAt:true},
        }),
        prisma.appointment.groupBy({
          by:    ["doctorId"],
          where: { clinicId, date:{gte:firstMonth}, status:{not:"CANCELLED"} },
          _count:{ id:true },
        }),
      ]);

    const doctorIds   = doctorStats.map(d => d.doctorId);
    const doctors     = await prisma.user.findMany({ where:{id:{in:doctorIds}}, select:{id:true,firstName:true,lastName:true,color:true} });
    const doctorMap   = Object.fromEntries(doctors.map(d => [d.id, d]));
    const activeDoctor = await prisma.user.count({ where:{clinicId,isActive:true,role:{in:["DOCTOR","ADMIN"]}} });
    const paidCount   = await prisma.invoice.count({ where:{clinicId,status:{in:["PAID","PARTIAL"]},updatedAt:{gte:firstMonth}} });

    const currentRev    = monthRevenue._sum.paid ?? 0;
    const prevRev       = prevMonthRevenue._sum.paid ?? 1;
    const revenueChange = prevRev > 0 ? Math.round(((currentRev-prevRev)/prevRev)*100) : 0;
    const apptChange    = prevMonthAppts > 0 ? Math.round(((monthAppts-prevMonthAppts)/prevMonthAppts)*100) : 0;
    const patientChange = prevMonthPatients > 0 ? Math.round(((monthPatients-prevMonthPatients)/prevMonthPatients)*100) : 0;
    const workingDays   = Math.min(now.getDate(), 22);
    const occupancy     = activeDoctor*workingDays*8 > 0 ? Math.min(100, Math.round((monthAppts/(activeDoctor*workingDays*8))*100)) : 0;
    const avgTicket     = paidCount > 0 ? Math.round(currentRev/paidCount) : 0;
    const lowInventoryAlerts = lowInventory.filter(i => i.quantity <= i.minQuantity);
    const pendingBalance = pendingInvoices._sum.balance ?? 0;
    const pendingCount   = typeof pendingInvoices._count === "number" ? pendingInvoices._count : 0;

    return NextResponse.json({
      todayAppointments: todayAppts, todayCount: todayAppts.length,
      todayCompleted: todayAppts.filter(a=>a.status==="COMPLETED").length,
      todayPending:   todayAppts.filter(a=>a.status==="PENDING").length,
      todayConfirmed: todayAppts.filter(a=>a.status==="CONFIRMED").length,
      monthAppointments: monthAppts, apptChange,
      monthPatients, patientChange,
      monthRevenue: currentRev, revenueChange, avgTicket, occupancy,
      pendingBalance, pendingInvoices: pendingCount,
      unconfirmedAppts, nextWeekAppointments: nextWeekAppts,
      lowInventory: lowInventoryAlerts, recentPatients,
      doctorBreakdown: doctorStats.map(d => ({ doctor: doctorMap[d.doctorId], count: d._count.id })),
    });
  } catch(err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
