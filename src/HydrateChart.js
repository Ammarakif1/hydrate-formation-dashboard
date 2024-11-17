// HydrateChart.js

import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer
} from 'recharts';
import './HydrateChart.css';
import { toPng } from 'html-to-image';
import Modal from 'react-modal';
import { FaSearchPlus, FaUndo, FaRedo, FaCog, FaSave, FaSync } from 'react-icons/fa'; // Import icons

Modal.setAppElement('#root');  // Set the app element for accessibility

function HydrateChart() {
  const [data, setData] = useState([]);
  const [hydrateEvents, setHydrateEvents] = useState([]); // New state for hydrate events
  const [referenceLines, setReferenceLines] = useState([]);
  const [activeLines, setActiveLines] = useState({
    InstantaneousVolume: true,
    SetpointVolume: true,
    ValvePercentOpen: true,
    PotentialHydrateFix: true,  // Added PotentialHydrateFix
    HydrateChance: true,
  });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chartKey, setChartKey] = useState(0); // Used to reset the chart
  const [zoomHistory, setZoomHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customSettings, setCustomSettings] = useState({
    xAxisMin: null,
    xAxisMax: null,
    yAxisMin: null,
    yAxisMax: null,
  });
  const [hydrateInfo, setHydrateInfo] = useState({
    hydrateChance: null,
    potentialFix: null,
  }); // Combined state for hydrate info

  const chartRef = useRef(null);

  // Handle file selection
  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  // Handle file upload
  const handleFileUpload = () => {
    if (!file) {
      alert('Please select a file first!');
      return;
    }

    setLoading(true); // Start loading

    const formData = new FormData();
    formData.append('file', file);

    axios.post('http://localhost:5000/api/hydrate_data', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    .then(response => {
      const processedData = response.data.data.map((item, index) => ({
        ...item,
        Time: new Date(item.Time).getTime(), // Convert to timestamp in milliseconds
        index: index // Keep track of the index for reference lines
      }));
      setData(processedData);
      setHydrateEvents(response.data.hydrateEvents); // Set hydrate events

      // Initialize hydrate info based on all data
      updateHydrateInfo(processedData);

      // Calculate reference lines
      const refLines = [];
      let isHydrating = false;

      for (let i = 1; i < processedData.length; i++) {
        const previousChance = processedData[i - 1].HydrateChance;
        const currentChance = processedData[i].HydrateChance;

        // Enter hydrating state when crossing upward over 50%
        if (!isHydrating && currentChance >= 50) {
          isHydrating = true;
          refLines.push({
            index: processedData[i].index,
            Time: processedData[i].Time,
            color: 'orange',
          });
        }

        // Exit hydrating state when dropping below 20%
        if (isHydrating && currentChance < 20) {
          isHydrating = false;
          refLines.push({
            index: processedData[i].index,
            Time: processedData[i].Time,
            color: 'gray',
          });
        }
      }

      setReferenceLines(refLines);
      setLoading(false); // End loading
      setChartKey(prevKey => prevKey + 1); // Reset chart to initial view
      // Initialize zoom history
      const initialDomain = {
        x: ['auto', 'auto'],
        yLeft: ['auto', 'auto'],
        yRight: [0, 100],
      };
      setZoomHistory([initialDomain]);
      setHistoryIndex(0);
    })
    .catch(error => {
      console.error('Error uploading file:', error);
      alert('An error occurred while uploading the file.');
      setLoading(false); // End loading
    });
  };

  // Function to update hydrate info based on visible data
  const updateHydrateInfo = (visibleData) => {
    if (visibleData.length > 0) {
      // Find the point with the maximum HydrateChance
      const maxHydratePoint = visibleData.reduce((maxPoint, currentPoint) => {
        return currentPoint.HydrateChance > maxPoint.HydrateChance ? currentPoint : maxPoint;
      }, visibleData[0]);

      setHydrateInfo({
        hydrateChance: maxHydratePoint.HydrateChance,
        potentialFix: maxHydratePoint.PotentialHydrateFix,
      });
    } else {
      setHydrateInfo({
        hydrateChance: null,
        potentialFix: null,
      });
    }
  };

  // Handle toggling lines on click
  const handleLegendClick = (e) => {
    const { dataKey } = e;
    setActiveLines(prevState => ({
      ...prevState,
      [dataKey]: !prevState[dataKey],
    }));
  };

  // Handle Zoom and Pan
  const handleMouseDown = (e) => {
    if (e && e.activeLabel) {
      const chart = chartRef.current;
      if (chart) {
        chart.state = {
          ...chart.state,
          startX: e.activeLabel,
          isPanning: true,
        };
      }
    }
  };

  const handleMouseMove = (e) => {
    const chart = chartRef.current;
    if (chart && chart.state && chart.state.isPanning && e && e.activeLabel) {
      chart.state = {
        ...chart.state,
        endX: e.activeLabel,
      };
    }
  };

  const handleMouseUp = () => {
    const chart = chartRef.current;
    if (chart && chart.state && chart.state.isPanning) {
      const { startX, endX } = chart.state;
      if (startX != null && endX != null && startX !== endX) {
        // Update domain
        const newDomain = {
          x: [Math.min(startX, endX), Math.max(startX, endX)],
          yLeft: ['auto', 'auto'],
          yRight: [0, 100],
        };
        updateZoomHistory(newDomain);
      }
      chart.state = {
        ...chart.state,
        startX: null,
        endX: null,
        isPanning: false,
      };
    }
  };

  const updateZoomHistory = (newDomain) => {
    const newHistory = zoomHistory.slice(0, historyIndex + 1);
    newHistory.push(newDomain);
    setZoomHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Reset Zoom Function
  const handleResetZoom = () => {
    if (zoomHistory.length > 0) {
      setHistoryIndex(0);
    }
  };

  // Back Navigation
  const handleZoomBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  };

  // Forward Navigation
  const handleZoomForward = () => {
    if (historyIndex < zoomHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
    }
  };

  // Zoom In Function
  const handleZoomIn = () => {
    const chart = chartRef.current;
    if (chart && data.length > 0) {
      const currentDomain = zoomHistory[historyIndex];
      const xRange = currentDomain.x[1] - currentDomain.x[0];
      const yLeftRange = currentDomain.yLeft[1] - currentDomain.yLeft[0];

      const newDomain = {
        x: [
          currentDomain.x[0] + xRange * 0.1,
          currentDomain.x[1] - xRange * 0.1,
        ],
        yLeft: [
          currentDomain.yLeft[0] + yLeftRange * 0.1,
          currentDomain.yLeft[1] - yLeftRange * 0.1,
        ],
        yRight: [0, 100],
      };

      updateZoomHistory(newDomain);
    }
  };

  // Customize Settings Modal
  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  const handleSettingsChange = (e) => {
    const { name, value } = e.target;
    setCustomSettings(prevState => ({
      ...prevState,
      [name]: value !== '' ? Number(value) : null,
    }));
  };

  const applySettings = () => {
    const { xAxisMin, xAxisMax, yAxisMin, yAxisMax } = customSettings;
    const newDomain = {
      x: [xAxisMin !== null ? xAxisMin : 'auto', xAxisMax !== null ? xAxisMax : 'auto'],
      yLeft: [yAxisMin !== null ? yAxisMin : 'auto', yAxisMax !== null ? yAxisMax : 'auto'],
      yRight: [0, 100],
    };
    updateZoomHistory(newDomain);
    closeModal();
  };

  // Save Chart as Image
  const handleSaveChart = () => {
    if (chartRef.current) {
      toPng(chartRef.current.container)
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = 'hydrate_chart.png';
          link.href = dataUrl;
          link.click();
        })
        .catch((error) => {
          console.error('Error saving chart as image:', error);
        });
    }
  };

  // Get current domain for axes
  const currentDomain = zoomHistory[historyIndex] || {
    x: ['auto', 'auto'],
    yLeft: ['auto', 'auto'],
    yRight: [0, 100],
  };

  // Update hydrate info when data or zoom changes
  useEffect(() => {
    if (data.length > 0) {
      const [xMin, xMax] = currentDomain.x;

      // Handle 'auto' domains
      const minX = xMin === 'auto' ? Math.min(...data.map(dp => dp.Time)) : xMin;
      const maxX = xMax === 'auto' ? Math.max(...data.map(dp => dp.Time)) : xMax;

      // Filter data points within the current x-axis domain
      const visibleData = data.filter(dp => dp.Time >= minX && dp.Time <= maxX);

      updateHydrateInfo(visibleData);
    }
  }, [currentDomain, data]);

  return (
    <div className="hydrate-chart-container">
      <h2 className="hydrate-chart-title">Hydrate Formation Detection with Hydrate Chance Over Time</h2>
      {/* File Upload Section */}
      <div className="file-upload-section">
        <input type="file" accept=".csv" onChange={handleFileChange} />
        <button onClick={handleFileUpload}>Upload and Process File</button>
      </div>
      {loading && <p className="loading-message">Loading...</p>}
      {data.length > 0 ? (
        <>
          <div className="chart-controls">
            <button onClick={handleResetZoom} title="Reset View" aria-label="Reset View">
              <FaSync />
            </button>
            <button onClick={handleZoomBack} title="Back" aria-label="Back">
              <FaUndo />
            </button>
            <button onClick={handleZoomForward} title="Forward" aria-label="Forward">
              <FaRedo />
            </button>
            <button onClick={handleZoomIn} title="Zoom In" aria-label="Zoom In">
              <FaSearchPlus />
            </button>
            <button onClick={openModal} title="Customize Settings" aria-label="Customize Settings">
              <FaCog />
            </button>
            <button onClick={handleSaveChart} title="Save Chart" aria-label="Save Chart">
              <FaSave />
            </button>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={600}>
              <LineChart
                key={chartKey}
                data={data}
                ref={chartRef}
                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {/* Chart components */}
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="Time"
                  domain={currentDomain.x}
                  name="Time"
                  tickFormatter={(unixTime) => new Date(unixTime).toLocaleString()}
                  type="number"
                  scale="time"
                  angle={-30}
                  textAnchor="end"
                  dy={10}
                  minTickGap={15}
                />
                <YAxis
                  yAxisId="left"
                  label={{ value: 'Volume', angle: -90, position: 'insideLeft' }}
                  domain={currentDomain.yLeft}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  label={{ value: 'Percent / Chance (%)', angle: -90, position: 'insideRight' }}
                  domain={currentDomain.yRight}
                />
                <Tooltip
                  labelFormatter={(label) => new Date(label).toLocaleString()}
                />
                <Legend verticalAlign="top" height={36} onClick={handleLegendClick} />
                {activeLines.InstantaneousVolume && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="InstantaneousVolume"
                    stroke="#8884d8"
                    name="Instantaneous Volume"
                    dot={false}
                  />
                )}
                {activeLines.SetpointVolume && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="SetpointVolume"
                    stroke="#82ca9d"
                    name="Setpoint Volume"
                    dot={false}
                  />
                )}
                {activeLines.ValvePercentOpen && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="ValvePercentOpen"
                    stroke="#ffc658"
                    name="Valve Percent Open"
                    dot={false}
                    strokeDasharray="5 5"
                  />
                )}
                {activeLines.PotentialHydrateFix && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="PotentialHydrateFix"
                    stroke="#ff00ff"
                    name="Potential Hydrate Fix"
                    dot={false}
                    strokeDasharray="3 4 5 2"
                  />
                )}
                {activeLines.HydrateChance && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="HydrateChance"
                    stroke="#ff7300"
                    name="Hydrate Chance"
                    dot={false}
                    strokeWidth={2}
                  />
                )}
                {/* Add Reference Lines */}
                {referenceLines.map((refLine, index) => (
                  <ReferenceLine
                    key={index}
                    x={refLine.Time}
                    stroke={refLine.color}
                    strokeDasharray="3 3"
                    yAxisId="left"
                    ifOverflow="extendDomain"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Display the chance of hydrate and potential fix under the chart */}
          {hydrateInfo.hydrateChance !== null && (
            <div className="hydrate-info">
              <p>Chance of Hydrate: {hydrateInfo.hydrateChance.toFixed(2)}%</p>
              {hydrateInfo.potentialFix !== null && (
                <p>Potential Fix: Reduce valve percent open to {hydrateInfo.potentialFix.toFixed(2)}%</p>
              )}
            </div>
          )}
          {/* Hydrate Events List */}
          {hydrateEvents.length > 0 && (
            <div className="hydrate-events-section">
              <h3>Hydrate Instances</h3>
              <table className="hydrate-events-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Hydrate Chance (%)</th>
                    <th>Potential Fix (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {hydrateEvents.map((event, index) => (
                    <tr key={index}>
                      <td>{new Date(event.Time).toLocaleString()}</td>
                      <td>{event.HydrateChance.toFixed(2)}</td>
                      <td>{event.PotentialHydrateFix !== null ? event.PotentialHydrateFix.toFixed(2) : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Customize Settings Modal */}
          <Modal
            isOpen={isModalOpen}
            onRequestClose={closeModal}
            contentLabel="Customize Chart Settings"
          >
            <h2>Customize Chart Settings</h2>
            <div className="modal-content">
              <label>
                X-Axis Min:
                <input
                  type="number"
                  name="xAxisMin"
                  value={customSettings.xAxisMin || ''}
                  onChange={handleSettingsChange}
                />
              </label>
              <label>
                X-Axis Max:
                <input
                  type="number"
                  name="xAxisMax"
                  value={customSettings.xAxisMax || ''}
                  onChange={handleSettingsChange}
                />
              </label>
              <label>
                Y-Axis Min:
                <input
                  type="number"
                  name="yAxisMin"
                  value={customSettings.yAxisMin || ''}
                  onChange={handleSettingsChange}
                />
              </label>
              <label>
                Y-Axis Max:
                <input
                  type="number"
                  name="yAxisMax"
                  value={customSettings.yAxisMax || ''}
                  onChange={handleSettingsChange}
                />
              </label>
              <div className="modal-buttons">
                <button onClick={applySettings}>Apply</button>
                <button onClick={closeModal}>Close</button>
              </div>
            </div>
          </Modal>
        </>
      ) : (
        !loading && <p className="loading-message">Please upload a CSV file to display the chart.</p>
      )}
    </div>
  );
}

export default HydrateChart;
