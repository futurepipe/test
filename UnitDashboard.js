import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import axios from 'axios';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import {
    Settings, Calendar, Clock, X, Info,
    Factory, Trash2, Plus, Wrench, CheckCircle, Save,
    MoveHorizontal, Search, LayoutGrid, Monitor,
    CalendarDays, Sun, CornerUpLeft, CornerUpRight, List,
    Cloud, CircleDollarSign, CalendarRange, FileText, Hash,
    Package, Briefcase, MapPin, Activity, Database
} from 'lucide-react';

import Sidebar from '../../Components/Sidebar';
import Navbar from '../../Components/Navbar';
import { MACHINE_CAPACITY } from '../../utils/machineData';

// ====== CONSTANTS ======
const THEME_BLUE = '#012555';
const THEME_ORANGE = '#fb9e3f';

// .NET / Enterprise Style Constants
const ROW_HEIGHT = 60; // Fixed row height for alignment
const HEADER_HEIGHT = 48;
const SIDEBAR_WIDTH = 320;

const CARD_STYLE = "bg-white border text-sm shadow-sm"; // Sharper corners for .net feel
const HEADER_STYLE = "px-4 py-2 border-b flex items-center justify-between bg-[#012555] text-white"; // Solid blue header
const BUTTON_PRIMARY = "inline-flex items-center justify-center px-4 py-2 bg-[#fb9e3f] text-[#012555] font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all border border-[#e68a2e]";
const BUTTON_SECONDARY = "inline-flex items-center justify-center px-4 py-2 bg-white text-[#012555] font-bold text-xs uppercase tracking-wider hover:bg-gray-50 transition-all border border-[#012555]";
const INPUT_STYLE = "flex h-9 w-full border border-gray-300 bg-white px-3 py-1 text-sm shadow-inner focus-visible:outline-none focus-visible:border-[#012555]";

// ====== HELPERS ======
export const getDNColor = (dn) => {
    const colors = ['#3f51b5', '#009688', '#795548', '#607d8b', '#E91E63', '#673AB7'];
    const hash = String(dn).split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    return colors[Math.abs(hash) % colors.length];
};

export const getDNBorderColor = (dn) => {
    const colors = ['#2E5C8A', '#2D8659', '#CC6D33', '#6B3D7C', '#117A65', '#C87F0A'];
    const hash = String(dn).split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    return colors[Math.abs(hash) % colors.length];
};

export const formatDateTime = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
};

export const formatHours = (hours) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// --- Scheduling Logic ---
const isDuringBreak = (date, breaks) => {
    const d = new Date(date);
    const timeInMinutes = d.getHours() * 60 + d.getMinutes();
    return breaks.some(b => {
        const [startH, startM] = b.start.split(':').map(Number);
        const [endH, endM] = b.end.split(':').map(Number);
        return timeInMinutes >= startH * 60 + startM && timeInMinutes < endH * 60 + endM;
    });
};

const isHoliday = (date, holidays) => {
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return holidays.includes(dateStr);
};

const getNextWorkingTime = (currentTime, breaks, holidays) => {
    let checkTime = new Date(currentTime);
    let loop = 0;
    while (loop < 5000) {
        loop++;
        if (isHoliday(checkTime, holidays)) {
            checkTime.setDate(checkTime.getDate() + 1);
            checkTime.setHours(0, 0, 0, 0);
            continue;
        }
        if (isDuringBreak(checkTime, breaks)) {
            const timeInMinutes = checkTime.getHours() * 60 + checkTime.getMinutes();
            const breakPeriod = breaks.find(b => {
                const [startH, startM] = b.start.split(':').map(Number);
                return timeInMinutes >= startH * 60 + startM;
            });
            if (breakPeriod) {
                const [endH, endM] = breakPeriod.end.split(':').map(Number);
                checkTime.setHours(endH, endM, 0, 0);
                continue;
            }
        }
        break;
    }
    return checkTime;
};

const addWorkingHours = (startTime, hours, breaks, holidays) => {
    let remainingMinutes = Math.round(hours * 60);
    let current = new Date(startTime);
    while (remainingMinutes > 0) {
        current = getNextWorkingTime(current, breaks, holidays);
        current.setMinutes(current.getMinutes() + 1);
        remainingMinutes--;
    }
    return current;
};

// --- SETUP MATRIX LOGIC ---
const processSetupMatrix = (rawData) => {
    if (!rawData || rawData.length < 2) return null;
    const lookup = {};
    const headerRow = rawData[0];
    const toDNs = [];
    for (let c = 1; c < headerRow.length; c++) {
        const val = headerRow[c] !== undefined ? String(headerRow[c]).trim() : null;
        if (val) toDNs[c] = val;
    }
    for (let r = 1; r < rawData.length; r++) {
        const row = rawData[r];
        const fromDN = row[0] !== undefined ? String(row[0]).trim() : null;
        if (fromDN) {
            lookup[fromDN] = {};
            for (let c = 1; c < row.length; c++) {
                const toDN = toDNs[c];
                if (toDN) {
                    const rawVal = row[c];
                    const hours = rawVal ? parseFloat(rawVal) : 0;
                    lookup[fromDN][toDN] = hours;
                }
            }
        }
    }
    return lookup;
};

const getSetupTime = (prevJob, currJob, matrixLookup) => {
    if (!matrixLookup || !prevJob) return 0;
    const fromDN = String(prevJob.dn).trim();
    const toDN = String(currJob.dn).trim();
    if (matrixLookup[fromDN]) {
        const val = matrixLookup[fromDN][toDN];
        if (typeof val === 'number') return val;
    }
    return 0;
};

const calculateSchedule = (jobs, matrixLookup, breaks, holidays, machineCapacity, manualOverrides = {}) => {
    const sortedJobs = [...jobs];
    let currentTime = new Date();
    currentTime.setMinutes(0, 0, 0);
    let previousJobEnd = getNextWorkingTime(currentTime, breaks, holidays);

    return sortedJobs.map((job, index) => {
        let setupTime = 0;
        if (index === 0 && matrixLookup) {
            setupTime = 0.5;
        } else if (index > 0 && matrixLookup) {
            setupTime = getSetupTime(sortedJobs[index - 1], job, matrixLookup);
        }

        let proposedStart = new Date(previousJobEnd);
        if (manualOverrides[job.id]) {
            const manualDate = new Date(manualOverrides[job.id]);
            if (manualDate > proposedStart) proposedStart = manualDate;
        }

        let actualSetupStart = getNextWorkingTime(proposedStart, breaks, holidays);
        let productionStart = actualSetupStart;
        if (setupTime > 0) {
            productionStart = addWorkingHours(actualSetupStart, setupTime, breaks, holidays);
        }
        const productionEnd = addWorkingHours(productionStart, job.capacity, breaks, holidays);
        previousJobEnd = productionEnd;

        return {
            ...job,
            setupTime,
            setupStart: actualSetupStart,
            productionStart: productionStart,
            scheduledStart: actualSetupStart,
            scheduledEnd: productionEnd,
            machine: machineCapacity.machine,
            workCentre: machineCapacity.workCentre,
            color: getDNColor(job.dn),
        };
    });
};

// ====== COMPONENT: ENHANCED JOB DETAILS POPUP WITH ALL UPLOADED DATA ======
const JobDetailsModal = ({ job, onClose }) => {
    const [fullJobData, setFullJobData] = useState(null);
    const [loading, setLoading] = useState(true);
    const token = localStorage.getItem('token');

    useEffect(() => {
        const fetchFullJobData = async () => {
            if (!job || !job.id) return;

            try {
                setLoading(true);
                const response = await axios.get(
                    `http://localhost:5000/api/uploaded-data/${job.id}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setFullJobData(response.data);
            } catch (err) {
                console.error("Failed to fetch full job data:", err);
                setFullJobData(null);
            } finally {
                setLoading(false);
            }
        };

        fetchFullJobData();
    }, [job, token]);

    if (!job) return null;

    // Prepare data table from ALL uploaded columns
    const prepareTableData = () => {
        if (!fullJobData) return [];
        const excludeFields = ['id', 'target_plant', 'job_uuid'];
        return Object.entries(fullJobData)
            .filter(([key]) => !excludeFields.includes(key))
            .map(([key, value]) => ({
                label: key.replace(/_/g, ' ').toUpperCase(),
                value: value || 'N/A'
            }));
    };

    const tableData = prepareTableData();

    // Add scheduling information if available
    // Add scheduling information if available
    const schedulingData = [
        { label: 'DN NUMBER', value: job.dn || 'N/A' },
        { label: 'ORDER NUMBER', value: job.order || 'N/A' },
        { label: 'EST. DURATION', value: formatHours(job.capacity) },
    ];

    if (job.machine) {
        schedulingData.push({ label: 'ASSIGNED MACHINE', value: job.machine });
        schedulingData.push({ label: 'WORK CENTRE', value: job.workCentre || 'N/A' });

        if (job.setupTime > 0) {
            schedulingData.push({ label: 'SETUP DURATION', value: formatHours(job.setupTime) });
            if (job.setupStart) {
                schedulingData.push({ label: 'SETUP START', value: formatDateTime(job.setupStart) });
            }
        }

        const prodStart = job.productionStart || job.scheduledStart;
        if (prodStart) {
            schedulingData.push({ label: 'PRODUCTION START', value: formatDateTime(prodStart) });
        }

        if (job.scheduledEnd) {
            schedulingData.push({ label: 'SCHEDULED END', value: formatDateTime(job.scheduledEnd) });
        }
    } else {
        schedulingData.push({ label: 'STATUS', value: 'UNASSIGNED' });
    }

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className={`w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden ${CARD_STYLE} animate-in zoom-in-95 duration-200`}>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-[#012555] text-white border-b border-[#fb9e3f] select-none">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-white/10 rounded-sm">
                            <Database className="w-5 h-5 text-[#fb9e3f]" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold tracking-wide">JOB INFORMATION</h3>
                            <p className="text-xs text-gray-300 font-mono mt-0.5">ID: {job.id}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-[#f8f9fa]">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="w-10 h-10 border-4 border-gray-200 border-t-[#012555] rounded-full animate-spin"></div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-8">
                            {/* Scheduling Section */}
                            {schedulingData.length > 0 && (
                                <div className="bg-white p-5 shadow-sm border border-gray-200 relative">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-[#fb9e3f]"></div>
                                    <h4 className="text-sm font-bold text-[#012555] flex items-center gap-2 mb-4 uppercase tracking-wider border-b pb-2">
                                        <Calendar className="w-4 h-4 text-[#fb9e3f]" /> Schedule Details
                                    </h4>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8">
                                        {schedulingData.map((item, index) => (
                                            <div key={index} className="flex flex-col">
                                                <span className="text-[10px] font-bold text-gray-500 uppercase">{item.label}</span>
                                                <span className="text-sm font-semibold text-[#012555] font-mono">{item.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Uploaded Data Section */}
                            {tableData.length > 0 && (
                                <div className="bg-white shadow-sm border border-gray-200">
                                    <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                                        <FileText className="w-4 h-4 text-[#fb9e3f]" />
                                        <h4 className="text-sm font-bold text-[#012555] uppercase tracking-wider">
                                            Original Upload Data
                                        </h4>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-50 text-[#012555] font-bold text-xs uppercase border-b border-gray-200">
                                                <tr>
                                                    <th className="px-5 py-3 w-1/3">Field Name</th>
                                                    <th className="px-5 py-3">Value</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {tableData.map((item, index) => (
                                                    <tr key={index} className="hover:bg-blue-50/50 transition-colors">
                                                        <td className="px-5 py-2.5 font-semibold text-gray-600 text-xs">{item.label}</td>
                                                        <td className="px-5 py-2.5 text-gray-800 font-mono text-xs">{item.value}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                    <button onClick={onClose} className={BUTTON_SECONDARY}>
                        Close Window
                    </button>
                </div>
            </div>
        </div>
    );
};

// ====== COMPONENTS ======

// ====== COMPONENTS ======

const JobCard = ({ job, isDragging, onShowDetails, onDelete, isAssigned, isSidebar }) => (
    <div
        className={`bg-white border-b border-gray-200 relative group transition-all duration-200 flex items-center overflow-hidden
        ${isDragging ? 'shadow-2xl z-50 brightness-110' : 'hover:bg-blue-50'}`}
        style={{
            height: `${ROW_HEIGHT}px`,
            borderLeft: `4px solid ${job.color}`,
            backgroundColor: isDragging ? '#fff' : undefined // Ensure dragging card has background
        }}
    >
        <div className="flex-1 px-3 py-1 flex items-center justify-between min-w-0">
            <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#012555] font-mono top-text">DN {job.dn}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-semibold text-gray-700 truncate max-w-[120px]" title={job.order}>{job.order}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatHours(job.capacity)}</span>
                </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); onShowDetails(job); }}
                    className="p-1.5 hover:bg-[#012555] hover:text-white rounded-sm text-gray-400 transition-colors">
                    <Info className="w-4 h-4" />
                </button>
                {!isDragging && (
                    <button onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                        className="p-1.5 hover:bg-red-600 hover:text-white rounded-sm text-gray-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    </div>
);

const TimelineView = ({ jobs, viewMode = 'daily', onJobMove, onShowDetails, scrollRef }) => {
    // Only internal dragging logic for movement on timeline
    const containerRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragJobId, setDragJobId] = useState(null);
    const [dragOriginalStart, setDragOriginalStart] = useState(null);
    const [dragCurrentTime, setDragCurrentTime] = useState(null);

    const now = new Date();
    let startDate, endDate, unitWidth, getTimePoints;

    if (viewMode === 'daily') {
        startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 2);
        unitWidth = 100; // Wider for better visibility
        getTimePoints = () => {
            const points = [];
            let curr = new Date(startDate);
            while (curr < endDate) { points.push(new Date(curr)); curr.setHours(curr.getHours() + 1); }
            return points;
        };
    } else if (viewMode === 'weekly') {
        startDate = new Date(now); startDate.setDate(now.getDate() - now.getDay()); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 14);
        unitWidth = 150;
        getTimePoints = () => {
            const points = [];
            let curr = new Date(startDate);
            while (curr < endDate) { points.push(new Date(curr)); curr.setDate(curr.getDate() + 1); }
            return points;
        };
    } else {
        startDate = new Date(now); startDate.setDate(1); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate); endDate.setMonth(endDate.getMonth() + 2);
        unitWidth = 80;
        getTimePoints = () => {
            const points = [];
            let curr = new Date(startDate);
            while (curr < endDate) { points.push(new Date(curr)); curr.setDate(curr.getDate() + 1); }
            return points;
        };
    }

    const getPosition = (date) => {
        if (viewMode === 'daily') {
            const diffMs = new Date(date) - startDate;
            return (diffMs / (1000 * 60 * 60)) * unitWidth;
        } else {
            const diffDays = (new Date(date) - startDate) / (1000 * 60 * 60 * 24);
            return diffDays * unitWidth;
        }
    };

    // Timeline Dragging Handlers
    const handleMouseMove = useCallback((e) => {
        if (!isDragging || !dragJobId) return;
        const deltaX = e.clientX - dragStartX;
        const msPerUnit = viewMode === 'daily' ? 3600000 : 86400000;
        const pxPerMs = unitWidth / msPerUnit;
        const deltaMs = deltaX / pxPerMs;
        setDragCurrentTime(new Date(dragOriginalStart + deltaMs));
    }, [isDragging, dragJobId, dragStartX, dragOriginalStart, unitWidth, viewMode]);

    const handleMouseUp = useCallback((e) => {
        if (!isDragging || !dragJobId) return;
        const msPerUnit = viewMode === 'daily' ? 3600000 : 86400000;
        const pxPerMs = unitWidth / msPerUnit;
        const deltaX = e.clientX - dragStartX;
        let deltaMs = deltaX / pxPerMs;

        let newTime = dragOriginalStart + deltaMs;
        const snapMs = 15 * 60000;
        newTime = Math.round(newTime / snapMs) * snapMs;
        if (newTime < startDate.getTime()) newTime = startDate.getTime();

        onJobMove(dragJobId, new Date(newTime));
        setIsDragging(false); setDragJobId(null); setDragCurrentTime(null);
    }, [isDragging, dragJobId, dragStartX, dragOriginalStart, onJobMove, unitWidth, viewMode, startDate]);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [isDragging, handleMouseMove, handleMouseUp]);

    const handleMouseDown = useCallback((e, job) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        setIsDragging(true); setDragStartX(e.clientX); setDragJobId(job.id);
        const startTime = new Date(job.setupStart || job.scheduledStart).getTime();
        setDragOriginalStart(startTime); setDragCurrentTime(new Date(startTime));
    }, []);

    // Sync header scroll with body scroll
    const handleBodyScroll = (e) => {
        if (containerRef.current) {
            containerRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    const timePoints = getTimePoints();
    const containerWidth = timePoints.length * unitWidth;
    const nowPosition = getPosition(now);

    return (
        <div className="flex flex-col h-full bg-white select-none border-l border-gray-200">
            {/* Timeline Header Track - Synced with Body Scroll */}
            <div className="h-[48px] border-b border-gray-300 flex items-end relative overflow-hidden bg-[#f0f4f8]"
                ref={containerRef}>
                <div style={{ width: `${Math.max(containerWidth, 1000)}px`, height: '100%', position: 'relative' }}>
                    {timePoints.map((tp, i) => {
                        const left = i * unitWidth;
                        const label = viewMode === 'daily'
                            ? tp.getHours().toString().padStart(2, '0') + ':00'
                            : tp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                        const isMidnight = viewMode === 'daily' && tp.getHours() === 0;

                        return (
                            <div key={i}
                                className={`absolute bottom-0 border-l ${isMidnight ? 'border-gray-400 h-full bg-black/5' : 'border-gray-300 h-1/2'} text-[10px] font-bold pl-2 pb-1 text-gray-600 flex flex-col justify-end`}
                                style={{ left: `${left}px`, width: `${unitWidth}px` }}>
                                {isMidnight && viewMode === 'daily' && (
                                    <span className="absolute top-1 left-1.5 text-[9px] text-[#012555] opacity-70">
                                        {tp.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
                                    </span>
                                )}
                                {label}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Timeline Scrollable Content - Synced with Parent List & Header */}
            <div className="flex-1 overflow-auto custom-scrollbar relative bg-white"
                ref={scrollRef}
                onScroll={handleBodyScroll}
            >
                <div style={{ width: `${Math.max(containerWidth, 1000)}px`, height: '100%' }} className="relative">

                    {/* Background Grid */}
                    <div className="absolute inset-0 z-0 pointer-events-none">
                        {timePoints.map((tp, i) => {
                            const isMidnight = viewMode === 'daily' && tp.getHours() === 0;
                            return (
                                <div key={i} className={`absolute top-0 bottom-0 border-r ${isMidnight ? 'border-gray-300 bg-gray-50/50' : 'border-gray-100'}`}
                                    style={{ left: `${(i + 1) * unitWidth}px` }} />
                            );
                        })}
                        {/* Horizontal Rows */}
                        {jobs.map((_, index) => (
                            <div key={index} className="absolute left-0 right-0 border-b border-gray-100"
                                style={{ top: `${(index + 1) * ROW_HEIGHT}px`, height: '1px' }} />
                        ))}
                    </div>

                    {/* NOW Indicator */}
                    {nowPosition >= 0 && (
                        <div className="absolute top-0 bottom-0 w-0.5 z-30 bg-[#fb9e3f] shadow-[0_0_8px_rgba(251,158,63,0.6)]" style={{ left: `${nowPosition}px` }}>
                            <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-[#fb9e3f] rounded-full border-2 border-white shadow-md"></div>
                        </div>
                    )}

                    {/* Bars */}
                    <div className="absolute top-0 w-full h-full z-10">
                        {jobs.map((job, index) => {
                            const isBeingDragged = isDragging && dragJobId === job.id;
                            let setupStart, prodStart;

                            if (isBeingDragged && dragCurrentTime) {
                                setupStart = dragCurrentTime;
                                const setupMs = (job.setupTime || 0) * 3600000;
                                prodStart = new Date(setupStart.getTime() + setupMs);
                            } else {
                                setupStart = new Date(job.setupStart);
                                prodStart = new Date(job.productionStart);
                            }

                            const msPerUnit = viewMode === 'daily' ? 3600000 : 86400000;
                            const pxPerMs = unitWidth / msPerUnit;
                            const setupDurationMs = (job.setupTime || 0) * 3600000;
                            const prodDurationMs = job.capacity * 3600000;

                            const setupLeft = getPosition(setupStart);
                            const setupWidth = setupDurationMs * pxPerMs;
                            const prodLeft = getPosition(prodStart);
                            const prodWidth = prodDurationMs * pxPerMs;

                            const topPos = index * ROW_HEIGHT + (ROW_HEIGHT - 32) / 2; // Center in row

                            return (
                                <div key={job.id}
                                    className={`absolute transition-opacity ${isBeingDragged ? 'z-50 opacity-90' : 'hover:z-30'}`}
                                    style={{ top: `${topPos}px`, height: `32px` }}
                                    onMouseDown={(e) => handleMouseDown(e, job)}
                                >
                                    {/* Setup Segment */}
                                    {job.setupTime > 0 && (
                                        <div className="absolute h-full flex items-center justify-center text-white text-[10px] bg-[#fb9e3f] border border-[#e68a2e] rounded-l-sm shadow-sm"
                                            style={{ left: `${setupLeft}px`, width: `${Math.max(setupWidth, 2)}px` }}
                                            title="Setup">
                                        </div>
                                    )}
                                    {/* Production Segment */}
                                    <div className={`absolute h-full flex items-center px-2 text-xs font-bold shadow-sm whitespace-nowrap cursor-grab active:cursor-grabbing border border-black/20 text-white
                                        ${job.setupTime > 0 ? 'rounded-r-md' : 'rounded-md'}`}
                                        style={{
                                            left: `${prodLeft}px`,
                                            width: `${Math.max(prodWidth, 5)}px`,
                                            backgroundColor: job.color,
                                            borderColor: getDNBorderColor(job.dn),
                                            background: `linear-gradient(180deg, ${job.color} 0%, ${getDNBorderColor(job.dn)} 100%)`
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onShowDetails(job);
                                        }}
                                    >
                                        <span className="drop-shadow-md text-[10px] truncate w-full block">DN {job.dn}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MachineLane = ({ machine, jobs, onShowDetails, onDeleteJob, onJobMove }) => {
    const [viewMode, setViewMode] = useState('daily');
    const scrollContainerRef = useRef(null);

    // Sync scroll helper
    const handleListScroll = (e) => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = e.target.scrollTop;
        }
    };

    return (
        <div className="bg-white border border-gray-300 shadow-md mb-8 flex flex-col overflow-hidden rounded-sm">
            {/* Machine Header */}
            <div className={`h-[48px] px-4 flex items-center justify-between bg-[#012555] text-white border-b border-[#fb9e3f]`}>
                <div className="flex items-center gap-3">
                    <Factory className="w-5 h-5 text-[#fb9e3f]" />
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider">{machine.machine}</h3>
                        <span className="text-[10px] text-gray-300">{machine.workCentre} • Cap: {machine.minDia}-{machine.maxDia}mm</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono mr-2 bg-black/20 px-2 py-1 rounded">
                        Total Jobs: {jobs.length}
                    </span>
                    {['daily', 'weekly', 'monthly'].map(mode => (
                        <button key={mode}
                            onClick={() => setViewMode(mode)}
                            className={`px-3 py-1 text-[10px] font-bold uppercase transition-all border
                            ${viewMode === mode ? 'bg-[#fb9e3f] text-[#012555] border-[#fb9e3f]' : 'bg-transparent text-gray-300 border-gray-600 hover:bg-white/10'}`}>
                            {mode}
                        </button>
                    ))}
                </div>
            </div>

            {/* Split View Content */}
            <div className="flex min-h-[400px] h-[50vh] border-t border-gray-200">
                {/* Left: Job Queue List */}
                <div className="w-[320px] bg-gray-50 border-r border-gray-300 flex flex-col shrink-0">
                    <div className="h-[48px] px-3 border-b border-gray-300 flex items-center justify-between bg-white text-xs font-bold text-[#012555]">
                        <span className="flex items-center gap-2"><List className="w-4 h-4" /> Job Queue</span>
                        <div className="flex items-center gap-2">
                            {jobs.length === 0 && <span className="text-gray-400 italic font-normal">Idle</span>}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar" onScroll={handleListScroll}>
                        <Droppable droppableId={machine.workCentre}>
                            {(provided, snapshot) => (
                                <div ref={provided.innerRef} {...provided.droppableProps}
                                    className={`min-h-full p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-blue-50/50' : ''}`}>
                                    {jobs.map((job, index) => (
                                        <Draggable key={job.id} draggableId={job.id} index={index}>
                                            {(provided, snapshot) => (
                                                <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                                    style={provided.draggableProps.style}>
                                                    <JobCard job={job} isDragging={snapshot.isDragging} onShowDetails={onShowDetails} onDelete={onDeleteJob} isAssigned={true} />
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                    {jobs.length === 0 && (
                                        <div className="h-32 flex flex-col items-center justify-center text-gray-400">
                                            <MoveHorizontal className="w-8 h-8 mb-2 opacity-20" />
                                            <span className="text-xs">Drag jobs here</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Droppable>
                    </div>
                </div>

                {/* Right: Timeline Visualization */}
                <div className="flex-1 flex flex-col min-w-0 bg-white">
                    <TimelineView
                        jobs={jobs}
                        viewMode={viewMode}
                        onJobMove={onJobMove}
                        onShowDetails={onShowDetails}
                        scrollRef={scrollContainerRef}
                    />
                </div>
            </div>
        </div>
    );
};

const UnassignedJobsPanel = ({ unassignedJobs, onShowDetails, onDeleteJob }) => {
    return (
        <div className="w-[300px] flex flex-col border border-gray-300 bg-white shadow-md shrink-0 h-[calc(100vh-140px)]">
            <div className="p-3 border-b border-gray-300 bg-[#012555] text-white flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-[#fb9e3f]" /> Available Jobs
                </h3>
                <span className="text-[10px] bg-[#fb9e3f] text-[#012555] px-2 py-0.5 font-bold shadow-sm">
                    {unassignedJobs.length}
                </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar bg-gray-50">
                <Droppable droppableId="unassigned" isDropDisabled={false}>
                    {(provided, snapshot) => (
                        <div ref={provided.innerRef} {...provided.droppableProps}
                            className={`min-h-full transition-colors ${snapshot.isDraggingOver ? 'bg-orange-50' : ''}`}>
                            {unassignedJobs.map((job, i) => (
                                <Draggable key={job.id} draggableId={job.id} index={i}>
                                    {(provided, snapshot) => (
                                        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} style={provided.draggableProps.style}>
                                            {/* Reuse JobCard but slightly different style could be applied if needed */}
                                            <div className="mb-2">
                                                <JobCard job={job} isDragging={snapshot.isDragging} onShowDetails={onShowDetails} onDelete={onDeleteJob} isAssigned={false} />
                                            </div>
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </div>
        </div>
    );
};

const UnitDashboard = () => {
    const [scheduledJobs, setScheduledJobs] = useState([]);
    const [availableJobsPool, setAvailableJobsPool] = useState([]);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [assignedJobsMap, setAssignedJobsMap] = useState({});
    const [manualOverrides, setManualOverrides] = useState({});
    const [matrixLookup, setMatrixLookup] = useState(null);

    const [selectedJob, setSelectedJob] = useState(null);

    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [breaks, setBreaks] = useState([{ start: '13:00', end: '13:30' }]);
    const [holidays, setHolidays] = useState([]);
    const [showBreakModal, setShowBreakModal] = useState(false);
    const [newBreak, setNewBreak] = useState({ start: '', end: '' });
    const [newHoliday, setNewHoliday] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);

    const token = localStorage.getItem('token');
    const unit = useMemo(() => {
        if (!token) return null;
        try { return JSON.parse(atob(token.split('.')[1])).unit; } catch (e) { return null; }
    }, [token]);

    const machines = useMemo(() => MACHINE_CAPACITY.filter(m => m.plant === unit), [unit]);

    const saveToHistory = useCallback((newAssigned, newOverrides) => {
        const currentState = { assignedJobsMap: JSON.parse(JSON.stringify(newAssigned)), manualOverrides: JSON.parse(JSON.stringify(newOverrides)) };
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(currentState);
        if (newHistory.length > 50) newHistory.shift();
        setHistory(newHistory); setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            const prev = history[historyIndex - 1];
            setAssignedJobsMap(prev.assignedJobsMap); setManualOverrides(prev.manualOverrides); setHistoryIndex(historyIndex - 1);
        }
    };
    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const next = history[historyIndex + 1];
            setAssignedJobsMap(next.assignedJobsMap); setManualOverrides(next.manualOverrides); setHistoryIndex(historyIndex + 1);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!unit) return;
            try {
                const [jobsRes, uploadedRes, configRes] = await Promise.all([
                    axios.get(`http://localhost:5000/api/jobs?unit=${unit}`, { headers: { Authorization: `Bearer ${token}` } }),
                    axios.get(`http://localhost:5000/api/uploaded-data?unit=${unit}`, { headers: { Authorization: `Bearer ${token}` } }),
                    axios.get(`http://localhost:5000/api/schedule-config?unit=${unit}`, { headers: { Authorization: `Bearer ${token}` } })
                ]);

                setScheduledJobs(jobsRes.data);

                const findVal = (row, ...keys) => {
                    for (let k of keys) {
                        const exact = row[k];
                        if (exact !== undefined) return exact;
                        const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
                        if (foundKey) return row[foundKey];
                    }
                    return '';
                };

                const formattedAvailable = uploadedRes.data.map(row => ({
                    id: row.job_uuid,
                    dn: findVal(row, 'dn', 'size', 'diameter'),
                    order: findVal(row, 'sales_order', 'order', 'so'),
                    capacity: parseFloat(findVal(row, 'capacity', 'production', 'time')) || 0,
                    project: findVal(row, 'project', 'desc'),
                    quantity: findVal(row, 'quantity', 'qty')
                }));
                setAvailableJobsPool(formattedAvailable);

                setBreaks(configRes.data.breaks || [{ start: '13:00', end: '13:30' }]);
                setHolidays(configRes.data.holidays || []);

                const initialMap = {};
                const initialOverrides = {};
                machines.forEach(m => initialMap[m.workCentre] = []);

                jobsRes.data.forEach(job => {
                    if (job.workCentre && initialMap[job.workCentre] !== undefined) {
                        initialMap[job.workCentre].push(job.id);
                    }
                });

                setAssignedJobsMap(initialMap);
                setManualOverrides(initialOverrides);
                setHistory([{ assignedJobsMap: initialMap, manualOverrides: initialOverrides }]);
                setHistoryIndex(0);

            } catch (err) { console.error("Fetch error", err); }
            finally { setLoading(false); }
        };
        fetchData();
    }, [unit, token, machines]);

    useEffect(() => {
        const fetchSetupMatrix = async () => {
            try {
                const response = await fetch('/setupMatrix.xlsx');
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const wb = XLSX.read(arrayBuffer, { type: 'array' });
                    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
                    const processedLookup = processSetupMatrix(rawData);

                    if (processedLookup && Object.keys(processedLookup).length > 0) {
                        setMatrixLookup(processedLookup);
                        console.log('Setup Matrix auto-loaded successfully.');
                    }
                }
            } catch (err) {
                console.warn('Could not auto-load setupMatrix.xlsx. Using default configuration.', err);
            }
        };
        fetchSetupMatrix();
    }, []);

    const allKnownJobs = useMemo(() => [...scheduledJobs, ...availableJobsPool], [scheduledJobs, availableJobsPool]);
    const assignedJobIds = useMemo(() => new Set(Object.values(assignedJobsMap).flat()), [assignedJobsMap]);

    const unassignedJobs = useMemo(() => {
        const filtered = availableJobsPool.filter(j => !assignedJobIds.has(j.id));
        if (!searchQuery) return filtered;
        const q = searchQuery.toLowerCase();
        return filtered.filter(j =>
            String(j.order || '').toLowerCase().includes(q) ||
            String(j.dn || '').includes(q) ||
            String(j.project || '').toLowerCase().includes(q)
        );
    }, [availableJobsPool, assignedJobIds, searchQuery]);

    const calculatedLanes = useMemo(() => {
        const result = {};
        machines.forEach(m => {
            const jobIds = assignedJobsMap[m.workCentre] || [];
            const laneJobs = jobIds.map(id => allKnownJobs.find(j => j.id === id)).filter(Boolean);
            result[m.workCentre] = calculateSchedule(laneJobs, matrixLookup, breaks, holidays, m, manualOverrides);
        });
        return result;
    }, [assignedJobsMap, allKnownJobs, matrixLookup, breaks, holidays, machines, manualOverrides]);

    const syncTimeoutRef = useRef(null);
    useEffect(() => {
        if (!loading && Object.keys(calculatedLanes).length > 0) {
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
            setIsSyncing(true);
            syncTimeoutRef.current = setTimeout(async () => {
                try {
                    const allJobsToSync = Object.values(calculatedLanes).flat();
                    if (allJobsToSync.length > 0) {
                        await axios.post('http://localhost:5000/api/jobs/sync', { jobs: allJobsToSync }, { headers: { Authorization: `Bearer ${token}` } });
                    }
                } catch (err) { console.error("Sync failed", err); }
                finally { setIsSyncing(false); }
            }, 1500);
        }
    }, [calculatedLanes, token, loading]);

    const handleDragEnd = (result) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        const job = allKnownJobs.find(j => j.id === draggableId);
        if (destination.droppableId !== 'unassigned') {
            const target = machines.find(m => m.workCentre === destination.droppableId);
            if (target && (job.dn < target.minDia || job.dn > target.maxDia)) {
                alert(`Configuration Limit: Machine ${target.machine} cannot process DN ${job.dn}`);
                return;
            }
        }

        const newMap = { ...assignedJobsMap };
        if (source.droppableId !== 'unassigned') {
            newMap[source.droppableId] = [...newMap[source.droppableId]];
            newMap[source.droppableId].splice(source.index, 1);
        }
        if (destination.droppableId !== 'unassigned') {
            newMap[destination.droppableId] = [...(newMap[destination.droppableId] || [])];
            newMap[destination.droppableId].splice(destination.index, 0, draggableId);
        }
        setAssignedJobsMap(newMap);

        let newOverrides = { ...manualOverrides };
        if (source.droppableId !== destination.droppableId) {
            delete newOverrides[draggableId];
            setManualOverrides(newOverrides);
        }
        saveToHistory(newMap, newOverrides);
    };

    const handleTimelineJobMove = (jobId, newStartTime) => {
        const updated = { ...manualOverrides, [jobId]: newStartTime };
        setManualOverrides(updated);
        saveToHistory(assignedJobsMap, updated);
    };

    const handleDeleteJob = async (jobId) => {
        if (!window.confirm("Delete this job permanently?")) return;
        try {
            await axios.delete(`http://localhost:5000/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
            setScheduledJobs(p => p.filter(j => j.id !== jobId));
            setAvailableJobsPool(p => p.filter(j => j.id !== jobId));

            const newMap = { ...assignedJobsMap };
            Object.keys(newMap).forEach(k => newMap[k] = newMap[k].filter(id => id !== jobId));
            setAssignedJobsMap(newMap);
            saveToHistory(newMap, manualOverrides);
        } catch (err) { alert("Delete failed"); }
    };

    const addBreak = () => {
        if (newBreak.start && newBreak.end) { setBreaks([...breaks, newBreak]); setNewBreak({ start: '', end: '' }); }
    };
    const deleteBreak = (index) => {
        const newBreaks = [...breaks];
        newBreaks.splice(index, 1);
        setBreaks(newBreaks);
    };

    const addHoliday = () => {
        if (newHoliday) { setHolidays([...holidays, newHoliday]); setNewHoliday(''); }
    };
    const deleteHoliday = (index) => {
        const newHolidays = [...holidays];
        newHolidays.splice(index, 1);
        setHolidays(newHolidays);
    };

    const saveConfiguration = async () => {
        try {
            await axios.post(`http://localhost:5000/api/schedule-config`, { unit, breaks, holidays }, { headers: { Authorization: `Bearer ${token}` } });
            alert('Configuration Saved Successfully!');
            setShowBreakModal(false);
        } catch (err) {
            console.error("Save config failed", err);
            alert('Failed to save configuration.');
        }
    };

    if (loading) return (
        <div className="h-screen w-full flex items-center justify-center bg-gray-100">
            <div className="flex flex-col items-center gap-4 bg-white p-8 border border-gray-300 shadow-lg">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-[#012555] rounded-full animate-spin"></div>
                <p className="font-bold text-sm tracking-widest text-[#012555]">INITIALIZING SYSTEM...</p>
            </div>
        </div>
    );

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex h-screen font-sans text-gray-900 overflow-hidden bg-[#eef2f6]">
                <Sidebar unit={unit} />
                <div className="flex-1 flex flex-col min-w-0">
                    <Navbar unit={unit} />
                    <main className="p-4 flex-1 overflow-y-auto custom-scrollbar">

                        {/* Top Control Bar - Toolbar Style */}
                        <div className="bg-white p-3 border border-gray-300 mb-4 flex flex-col lg:flex-row justify-between items-center shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="p-2 border border-gray-200 bg-gray-50">
                                    <LayoutGrid className="w-6 h-6 text-[#012555]" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-3 text-[#012555] leading-none">
                                        {unit} SCHEDULER
                                    </h2>
                                    <div className="flex items-center gap-4 mt-1">
                                        <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 border ${isSyncing ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                                            {isSyncing ? <Cloud className="w-3 h-3 animate-pulse" /> : <CheckCircle className="w-3 h-3" />}
                                            {isSyncing ? 'SYNCING DATA...' : 'SYSTEM READY'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex border border-gray-300 bg-white">
                                    <button
                                        onClick={handleUndo}
                                        disabled={historyIndex <= 0}
                                        className={`h-8 w-10 flex items-center justify-center border-r border-gray-300 hover:bg-gray-100 ${historyIndex <= 0 ? 'opacity-50' : ''}`}
                                        title="Undo">
                                        <CornerUpLeft className="w-4 h-4 text-[#012555]" />
                                    </button>
                                    <button
                                        onClick={handleRedo}
                                        disabled={historyIndex >= history.length - 1}
                                        className={`h-8 w-10 flex items-center justify-center hover:bg-gray-100 ${historyIndex >= history.length - 1 ? 'opacity-50' : ''}`}
                                        title="Redo">
                                        <CornerUpRight className="w-4 h-4 text-[#012555]" />
                                    </button>
                                </div>

                                <div className="relative w-64">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input type="text"
                                        placeholder="Search Jobs..."
                                        className="h-9 w-full border border-gray-300 pl-9 pr-3 text-sm focus:outline-none focus:border-[#012555] shadow-inner"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)} />
                                </div>

                                <button onClick={() => setShowBreakModal(true)} className={BUTTON_PRIMARY} style={{ height: '36px' }}>
                                    <Settings className="w-4 h-4 mr-2" /> CONFIG
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col xl:flex-row gap-4 h-full">
                            <UnassignedJobsPanel unassignedJobs={unassignedJobs} onShowDetails={setSelectedJob} onDeleteJob={handleDeleteJob} />

                            <div className="flex-1 overflow-y-auto pr-2 pb-24 custom-scrollbar">
                                {machines.length === 0 ?
                                    <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 bg-white">
                                        <Monitor className="w-12 h-12 mb-4 text-gray-300" />
                                        <h3 className="text-lg font-bold text-gray-500">No Workcentres Configured</h3>
                                    </div> :
                                    machines.map(m => (
                                        <MachineLane
                                            key={m.workCentre}
                                            machine={m}
                                            jobs={calculatedLanes[m.workCentre] || []}
                                            onShowDetails={setSelectedJob}
                                            onDeleteJob={handleDeleteJob}
                                            onJobMove={handleTimelineJobMove}
                                        />
                                    ))
                                }
                            </div>
                        </div>
                    </main>
                </div>

                {/* JOB DETAILS MODAL */}
                {selectedJob && <JobDetailsModal job={selectedJob} onClose={() => setSelectedJob(null)} />}

                {/* Configuration Modal */}
                {showBreakModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="w-full max-w-lg bg-white shadow-2xl border border-gray-400 flex flex-col">
                            {/* Modal Header */}
                            <div className="px-4 py-3 bg-[#012555] text-white flex items-center justify-between border-b border-[#fb9e3f]">
                                <div className="flex items-center gap-3">
                                    <div className="bg-white/10 p-1.5 rounded-sm">
                                        <Settings className="w-5 h-5 text-[#fb9e3f]" />
                                    </div>
                                    <h3 className="text-lg font-bold uppercase tracking-wider">System Configuration</h3>
                                </div>
                                <button onClick={() => setShowBreakModal(false)} className="text-gray-300 hover:text-white transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 space-y-8 bg-[#f8f9fa] flex-1 overflow-y-auto max-h-[70vh]">

                                {/* Break Times Section */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-[#012555] uppercase tracking-wide border-b border-gray-300 pb-1 flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-[#fb9e3f]" /> Shift Breaks
                                    </h4>
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] uppercase font-bold text-gray-500 mb-1 block">Start Time</label>
                                            <input type="time" className={INPUT_STYLE}
                                                value={newBreak.start} onChange={e => setNewBreak({ ...newBreak, start: e.target.value })} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] uppercase font-bold text-gray-500 mb-1 block">End Time</label>
                                            <input type="time" className={INPUT_STYLE}
                                                value={newBreak.end} onChange={e => setNewBreak({ ...newBreak, end: e.target.value })} />
                                        </div>
                                        <button onClick={addBreak} className={BUTTON_PRIMARY} style={{ height: '36px', width: '36px', padding: 0 }}>
                                            <Plus className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <div className="bg-white border border-gray-300 shadow-inner max-h-32 overflow-y-auto">
                                        {breaks.length === 0 ? (
                                            <div className="p-3 text-xs text-center text-gray-400 italic">No breaks defined</div>
                                        ) : (
                                            <table className="w-full text-xs">
                                                <tbody className="divide-y divide-gray-100">
                                                    {breaks.map((b, i) => (
                                                        <tr key={i} className="hover:bg-blue-50/50 group">
                                                            <td className="px-3 py-2 font-mono text-[#012555]">{b.start} - {b.end}</td>
                                                            <td className="px-3 py-2 text-right">
                                                                <button onClick={() => deleteBreak(i)} className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>

                                {/* Holidays Section */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-[#012555] uppercase tracking-wide border-b border-gray-300 pb-1 flex items-center gap-2">
                                        <CalendarDays className="w-4 h-4 text-[#fb9e3f]" /> Holidays / Non-Working Days
                                    </h4>
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] uppercase font-bold text-gray-500 mb-1 block">Select Date</label>
                                            <input type="date" className={INPUT_STYLE}
                                                value={newHoliday} onChange={e => setNewHoliday(e.target.value)} />
                                        </div>
                                        <button onClick={addHoliday} className={BUTTON_PRIMARY} style={{ height: '36px', width: '36px', padding: 0 }}>
                                            <Plus className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <div className="bg-white border border-gray-300 shadow-inner max-h-32 overflow-y-auto">
                                        {holidays.length === 0 ? (
                                            <div className="p-3 text-xs text-center text-gray-400 italic">No holidays defined</div>
                                        ) : (
                                            <table className="w-full text-xs">
                                                <tbody className="divide-y divide-gray-100">
                                                    {holidays.map((h, i) => (
                                                        <tr key={i} className="hover:bg-blue-50/50 group">
                                                            <td className="px-3 py-2 font-mono text-[#012555] flex items-center gap-2">
                                                                <Sun className="w-3 h-3 text-[#fb9e3f]" /> {h}
                                                            </td>
                                                            <td className="px-3 py-2 text-right">
                                                                <button onClick={() => deleteHoliday(i)} className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-4 bg-gray-100 border-t border-gray-300 flex justify-end gap-2">
                                <button onClick={() => setShowBreakModal(false)} className={BUTTON_SECONDARY}>Cancel</button>
                                <button onClick={saveConfiguration} className={BUTTON_PRIMARY + " pl-3 pr-4"}>
                                    <Save className="w-4 h-4 mr-2" /> Save Configuration
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DragDropContext>
    );
};

export default UnitDashboard;