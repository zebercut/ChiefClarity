#!/usr/bin/env python3
"""
Data Manager for Chief Clarity
Implements hybrid data architecture with index.json and SQLite
"""

import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any


class IndexManager:
    """Manages index.json for fast metadata and caching"""
    
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.index_file = data_dir / "index.json"
        self.index = self._load_or_create()
    
    def _load_or_create(self) -> Dict:
        """Load existing index or create new one"""
        if self.index_file.exists():
            with open(self.index_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        
        # Create new index
        return {
            "version": "1.0.0",
            "last_updated": datetime.now().isoformat(),
            "files": {},
            "cache": {
                "web_search": {},
                "learned_patterns": {},
                "api_responses": {}
            },
            "metadata": {
                "total_runs": 0,
                "last_successful_run": None,
                "agents_used": []
            }
        }
    
    def save(self):
        """Save index to disk"""
        self.index["last_updated"] = datetime.now().isoformat()
        with open(self.index_file, 'w', encoding='utf-8') as f:
            json.dump(self.index, f, indent=2)
    
    def update_file_metadata(self, filename: str, metadata: Dict):
        """Update metadata for a file"""
        self.index["files"][filename] = {
            **metadata,
            "last_modified": datetime.now().isoformat()
        }
        self.save()
    
    def get_file_metadata(self, filename: str) -> Optional[Dict]:
        """Get metadata for a file"""
        return self.index["files"].get(filename)
    
    def file_changed_since(self, filename: str, since: datetime) -> bool:
        """Check if file changed since given time"""
        metadata = self.get_file_metadata(filename)
        if not metadata:
            return True  # File not tracked, assume changed
        
        last_modified = datetime.fromisoformat(metadata["last_modified"])
        return last_modified > since
    
    def get_changed_files(self, since: datetime) -> List[str]:
        """Get list of files that changed since given time"""
        changed = []
        for filename, metadata in self.index["files"].items():
            last_modified = datetime.fromisoformat(metadata["last_modified"])
            if last_modified > since:
                changed.append(filename)
        return changed
    
    def cache_search(self, query: str, results: Any, ttl_hours: int = 24):
        """Cache search results"""
        self.index["cache"]["web_search"][query] = {
            "result": results,
            "timestamp": datetime.now().isoformat(),
            "expires": (datetime.now() + timedelta(hours=ttl_hours)).isoformat()
        }
        self.save()
    
    def get_cached_search(self, query: str) -> Optional[Any]:
        """Get cached search results if not expired"""
        cached = self.index["cache"]["web_search"].get(query)
        if not cached:
            return None
        
        expires = datetime.fromisoformat(cached["expires"])
        if datetime.now() > expires:
            # Expired, remove from cache
            del self.index["cache"]["web_search"][query]
            self.save()
            return None
        
        return cached["result"]
    
    def cache_patterns(self, patterns: Dict):
        """Cache learned patterns"""
        self.index["cache"]["learned_patterns"] = {
            **patterns,
            "last_updated": datetime.now().isoformat()
        }
        self.save()
    
    def get_cached_patterns(self) -> Optional[Dict]:
        """Get cached learned patterns"""
        return self.index["cache"]["learned_patterns"]
    
    def update_run_metadata(self, run_id: str, agents: List[str]):
        """Update metadata after successful run"""
        self.index["metadata"]["total_runs"] += 1
        self.index["metadata"]["last_successful_run"] = datetime.now().isoformat()
        self.index["metadata"]["agents_used"] = agents
        self.save()


class DatabaseManager:
    """Manages SQLite database for history and analytics"""
    
    def __init__(self, data_dir: Path):
        self.db_path = data_dir / "chiefclarity.db"
        self.conn = sqlite3.connect(self.db_path)
        self._create_schema()
    
    def _create_schema(self):
        """Create database schema if not exists"""
        cursor = self.conn.cursor()
        
        # Runs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                timestamp DATETIME,
                mode TEXT,
                user_request TEXT,
                status TEXT,
                duration_seconds REAL
            )
        """)
        
        # Agent executions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS agent_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                agent_name TEXT,
                start_time DATETIME,
                end_time DATETIME,
                status TEXT,
                tokens_used INTEGER,
                error_message TEXT,
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            )
        """)
        
        # Search history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT,
                results TEXT,
                timestamp DATETIME,
                expires DATETIME
            )
        """)
        
        # Learned patterns table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS learned_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_type TEXT,
                pattern_data TEXT,
                confidence REAL,
                learned_date DATE,
                last_validated DATE
            )
        """)
        
        # Behavior metrics table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS behavior_metrics (
                date DATE PRIMARY KEY,
                deep_work_hours REAL,
                meetings_count INTEGER,
                tasks_completed INTEGER,
                avg_task_completion_time REAL
            )
        """)
        
        self.conn.commit()
    
    def log_run(self, run_id: str, mode: str, user_request: str, 
                status: str, duration: float):
        """Log a workflow run"""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO runs (run_id, timestamp, mode, user_request, status, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (run_id, datetime.now(), mode, user_request, status, duration))
        self.conn.commit()
    
    def log_agent_execution(self, run_id: str, agent_name: str, 
                           start_time: datetime, end_time: datetime,
                           status: str, tokens_used: int = 0, 
                           error_message: str = None):
        """Log an agent execution"""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO agent_executions 
            (run_id, agent_name, start_time, end_time, status, tokens_used, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (run_id, agent_name, start_time, end_time, status, tokens_used, error_message))
        self.conn.commit()
    
    def log_search(self, query: str, results: str, ttl_hours: int = 24):
        """Log a search query"""
        cursor = self.conn.cursor()
        expires = datetime.now() + timedelta(hours=ttl_hours)
        cursor.execute("""
            INSERT INTO search_history (query, results, timestamp, expires)
            VALUES (?, ?, ?, ?)
        """, (query, results, datetime.now(), expires))
        self.conn.commit()
    
    def get_recent_runs(self, limit: int = 10) -> List[Dict]:
        """Get recent runs"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT run_id, timestamp, mode, user_request, status, duration_seconds
            FROM runs
            ORDER BY timestamp DESC
            LIMIT ?
        """, (limit,))
        
        rows = cursor.fetchall()
        return [
            {
                "run_id": row[0],
                "timestamp": row[1],
                "mode": row[2],
                "user_request": row[3],
                "status": row[4],
                "duration_seconds": row[5]
            }
            for row in rows
        ]
    
    def get_agent_stats(self, agent_name: str, days: int = 30) -> Dict:
        """Get statistics for an agent"""
        cursor = self.conn.cursor()
        since = datetime.now() - timedelta(days=days)
        
        cursor.execute("""
            SELECT 
                COUNT(*) as total_executions,
                AVG(tokens_used) as avg_tokens,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed
            FROM agent_executions
            WHERE agent_name = ? AND start_time > ?
        """, (agent_name, since))
        
        row = cursor.fetchone()
        return {
            "total_executions": row[0],
            "avg_tokens": row[1],
            "successful": row[2],
            "failed": row[3],
            "success_rate": row[2] / row[0] if row[0] > 0 else 0
        }
    
    def close(self):
        """Close database connection"""
        self.conn.close()


class DataManager:
    """Main data manager combining index and database"""
    
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.index = IndexManager(data_dir)
        self.db = DatabaseManager(data_dir)
    
    def start_run(self, run_id: str, mode: str, user_request: str):
        """Initialize a new run"""
        self.run_id = run_id
        self.mode = mode
        self.user_request = user_request
        self.start_time = datetime.now()
        self.agents_executed = []
    
    def end_run(self, status: str):
        """Finalize a run"""
        duration = (datetime.now() - self.start_time).total_seconds()
        self.db.log_run(self.run_id, self.mode, self.user_request, status, duration)
        
        if status == "completed":
            self.index.update_run_metadata(self.run_id, self.agents_executed)
    
    def log_agent_start(self, agent_name: str):
        """Log agent execution start"""
        self.current_agent = agent_name
        self.agent_start_time = datetime.now()
        self.agents_executed.append(agent_name)
    
    def log_agent_end(self, status: str, tokens_used: int = 0, error: str = None):
        """Log agent execution end"""
        self.db.log_agent_execution(
            self.run_id,
            self.current_agent,
            self.agent_start_time,
            datetime.now(),
            status,
            tokens_used,
            error
        )
    
    def get_changed_files(self, since: Optional[datetime] = None) -> List[str]:
        """Get files that changed since last run"""
        if since is None:
            # Use last successful run time
            last_run = self.index.index["metadata"].get("last_successful_run")
            if last_run:
                since = datetime.fromisoformat(last_run)
            else:
                # First run, return all files
                return list(self.index.index["files"].keys())
        
        return self.index.get_changed_files(since)
    
    def close(self):
        """Close all connections"""
        self.db.close()
