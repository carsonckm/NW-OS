/**
 * NW OS — Cutting List, Production Parts & Material Link Module
 * Precision panel saw cutting dimensions, grain orientation, and material traceability
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  Scissors,
  Layers,
  Search,
  Filter,
  Printer,
  Download,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Compass,
  Boxes,
  Cpu,
  Package,
} from 'lucide-react';
import { PartStatus } from '../../types';

export const CuttingListAndPartsTab: React.FC = () => {
  const {
    productionParts,
    productionMaterials,
    productionOrders,
    updatePartStatus,
  } = useNW();

  const [activeSubView, setActiveSubView] = useState<'cutting-list' | 'parts' | 'materials'>('cutting-list');
  const [filterMaterial, setFilterMaterial] = useState<string>('ALL');
  const [filterThickness, setFilterThickness] = useState<string>('ALL');
  const [filterOrder, setFilterOrder] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract unique materials & thicknesses
  const uniqueMaterials = Array.from(new Set(productionParts.map((p) => p.material)));
  const uniqueThicknesses = Array.from(new Set<number>(productionParts.map((p) => p.thickness_mm))).sort((a, b) => a - b);
  const uniqueOrders = Array.from(new Set(productionParts.map((p) => p.production_order_number)));

  const filteredParts = productionParts.filter((part) => {
    const matchSearch =
      part.part_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.part_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.material.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.production_order_number.toLowerCase().includes(searchQuery.toLowerCase());
    const matchMat = filterMaterial === 'ALL' || part.material === filterMaterial;
    const matchThick = filterThickness === 'ALL' || part.thickness_mm.toString() === filterThickness;
    const matchOrder = filterOrder === 'ALL' || part.production_order_number === filterOrder;
    return matchSearch && matchMat && matchThick && matchOrder;
  });

  const handlePrintCuttingList = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex space-x-1.5">
          <button
            onClick={() => setActiveSubView('cutting-list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 ${
              activeSubView === 'cutting-list'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cutting List</span>
          </button>
          <button
            onClick={() => setActiveSubView('parts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 ${
              activeSubView === 'parts'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Component Parts Directory ({productionParts.length})</span>
          </button>
          <button
            onClick={() => setActiveSubView('materials')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 ${
              activeSubView === 'materials'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Approved Materials & Stock</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handlePrintCuttingList}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print List</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: CUTTING LIST */}
      {activeSubView === 'cutting-list' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search part, code, or material..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter Material"
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                className="bg-white text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium"
              >
                <option value="ALL">All Materials</option>
                {uniqueMaterials.map((mat) => (
                  <option key={mat} value={mat}>
                    {mat}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter Thickness"
                value={filterThickness}
                onChange={(e) => setFilterThickness(e.target.value)}
                className="bg-white text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium"
              >
                <option value="ALL">All Thicknesses</option>
                {uniqueThicknesses.map((th) => (
                  <option key={th} value={th.toString()}>
                    {th}mm
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter Order"
                value={filterOrder}
                onChange={(e) => setFilterOrder(e.target.value)}
                className="bg-white text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium"
              >
                <option value="ALL">All Production Orders</option>
                {uniqueOrders.map((ord) => (
                  <option key={ord} value={ord}>
                    {ord}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cutting List Table (Section 10 Requirement) */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Scissors className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Workshop Cutting List ({filteredParts.length} Parts Scheduled)
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Panel Saw Operator: Mohd Hafiz</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Part ID</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Thick</th>
                    <th className="py-2.5 px-3">Length (L)</th>
                    <th className="py-2.5 px-3">Width (W)</th>
                    <th className="py-2.5 px-3">Qty</th>
                    <th className="py-2.5 px-3">Grain</th>
                    <th className="py-2.5 px-3">Edge Banding</th>
                    <th className="py-2.5 px-3">Drawing Ref</th>
                    <th className="py-2.5 px-3">Order</th>
                    <th className="py-2.5 px-3 text-right">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredParts.map((part) => (
                    <tr key={part.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {part.part_code}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 font-semibold max-w-[160px] truncate" title={part.part_name}>
                        {part.part_name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-[150px] truncate" title={part.material}>
                        {part.material}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {part.thickness_mm}mm
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700 bg-blue-50/40">
                        {part.length_mm}mm
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-700 bg-indigo-50/40">
                        {part.width_mm}mm
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        {part.quantity}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center space-x-1 text-[11px] text-slate-700">
                          <Compass className="w-3 h-3 text-amber-600" />
                          <span>{part.grain_direction}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-[160px] truncate" title={part.edge_banding}>
                        {part.edge_banding}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500">
                        {part.drawing_reference}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 text-[11px]">
                        {part.production_order_number}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-800">
                          {part.current_stage}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: COMPONENT PARTS DIRECTORY */}
      {activeSubView === 'parts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productionParts.map((part) => (
            <div
              key={part.id}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 hover:border-amber-400 transition-colors"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-slate-900 font-mono text-xs">{part.part_code}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-900">
                  {part.current_stage}
                </span>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 text-xs">{part.part_name}</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{part.description}</p>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Dimensions</span>
                  <span className="font-bold font-mono text-slate-900">
                    {part.length_mm} × {part.width_mm} × {part.thickness_mm}mm
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Grain</span>
                  <span className="font-semibold text-slate-800">{part.grain_direction}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Material</span>
                  <span className="font-semibold text-slate-800 truncate block">{part.material}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Edge Banding</span>
                  <span className="font-semibold text-slate-800 truncate block">{part.edge_banding}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] pt-1 text-slate-500 border-t border-slate-100">
                <span className="font-mono">PO: {part.production_order_number}</span>
                <span className="font-mono">Barcode: {part.barcode}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW 3: APPROVED MATERIALS & INVENTORY LINK (Section 9 Requirement) */}
      {activeSubView === 'materials' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">Material Substitution Governance:</span> Production Staff are strictly
              prohibited from silently substituting materials on the shop floor. Material changes require formal
              Project Manager and Owner technical review.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {productionMaterials.map((mat) => (
              <div
                key={mat.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-mono font-bold text-xs text-slate-900">{mat.material_code}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-800">
                    {mat.thickness_mm}mm
                  </span>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-xs">{mat.material_name}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">{mat.colour_finish}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg space-y-1.5 text-xs text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Supplier:</span>
                    <span className="font-semibold text-slate-900">{mat.supplier_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Sheet Size:</span>
                    <span className="font-mono font-bold text-slate-900">{mat.sheet_size}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current Stock:</span>
                    <span className="font-mono font-bold text-emerald-700">{mat.current_stock_sheets} sheets available</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Unit Cost:</span>
                    <span className="font-mono font-bold text-slate-900">RM {mat.unit_cost}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Approved Projects</span>
                  <div className="flex flex-wrap gap-1">
                    {mat.approved_project_use.map((proj, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium"
                      >
                        {proj}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
