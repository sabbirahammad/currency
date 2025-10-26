import React, { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged, 
    signOut 
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    query, 
    onSnapshot, 
    addDoc 
} from 'firebase/firestore';

// Global context variables (defined externally in the canvas environment)
// const __app_id: string; 
// const __firebase_config: string;
// const __initial_auth_token: string;

export default function CurrencyDetector() {
    // --- Application State ---
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const [history, setHistory] = useState([]);
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState(0);
    const fileInputRef = useRef(null);

    // --- Firebase/Auth State ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isAnonymous, setIsAnonymous] = useState(true);

    // --- Firebase Initialization and Auth Setup ---
    useEffect(() => {
        if (typeof window !== 'undefined' && typeof __firebase_config !== 'undefined') {
            try {
                const firebaseConfig = JSON.parse(__firebase_config);
                const app = initializeApp(firebaseConfig);
                const authInstance = getAuth(app);
                const dbInstance = getFirestore(app);

                setAuth(authInstance);
                setDb(dbInstance);

                const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                        setIsAnonymous(user.isAnonymous);
                        console.log("User authenticated:", user.uid, "Anonymous:", user.isAnonymous);
                    } else {
                        // Attempt to sign in using the custom token if available
                        try {
                            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                                await signInWithCustomToken(authInstance, __initial_auth_token);
                                console.log("Signed in with custom token.");
                            } else {
                                // Fallback to anonymous sign-in
                                await signInAnonymously(authInstance);
                                console.log("Signed in anonymously.");
                            }
                        } catch (error) {
                            console.error("Authentication failed during initial sign-in:", error);
                            // Fallback to anonymous on error
                            await signInAnonymously(authInstance).catch(e => console.error("Anonymous sign-in failed:", e));
                        }
                    }
                    setIsAuthReady(true);
                });

                return () => unsubscribeAuth();
            } catch (e) {
                console.error("Firebase Initialization Error:", e);
                setError("Firebase initialization failed. Check __firebase_config.");
            }
        }
    }, []);

    // --- Firestore History Listener ---
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        // Path: /artifacts/{appId}/users/{userId}/currency_detections
        const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/currency_detections`);
        
        // Use a simple query and sort locally to avoid index issues with orderBy()
        const q = query(historyCollectionRef); 

        console.log("Setting up Firestore listener for:", `artifacts/${appId}/users/${userId}/currency_detections`);

        const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
            const newHistory = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Convert Firestore Timestamp to local string for display
                    timestamp: data.rawTimestamp 
                        ? new Date(data.rawTimestamp.toDate()).toLocaleString('bn-BD')
                        : new Date().toLocaleString('bn-BD'), // Fallback
                    rawTimestamp: data.rawTimestamp // Keep raw timestamp for accurate local sorting
                };
            })
            // Sort by rawTimestamp descending and limit to 10
            .sort((a, b) => (b.rawTimestamp?.seconds || 0) - (a.rawTimestamp?.seconds || 0))
            .slice(0, 10);

            setHistory(newHistory);

        }, (error) => {
            console.error("Failed to fetch history from Firestore:", error);
            setError("Failed to load history from Firestore.");
        });

        return () => unsubscribeSnapshot();
    }, [isAuthReady, db, userId]);

    // --- Logout Function ---
    const handleLogout = async () => {
        if (auth) {
            try {
                await signOut(auth);
                // After sign out, the onAuthStateChanged listener will attempt anonymous sign-in again
                console.log("User signed out.");
                setHistory([]); // Clear history immediately on logout
            } catch (e) {
                console.error("Logout failed:", e);
                setError("Logout failed.");
            }
        }
    };


    // --- File Handling Logic (same as before) ---
    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type.startsWith('image/')) {
                setFile(droppedFile);
                setPreview(URL.createObjectURL(droppedFile));
                setError(null);
            } else {
                setError("প্লিজ একটি valid image file upload করুন।");
            }
        }
    }, []);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            if (selectedFile.size > 10 * 1024 * 1024) {
                setError("ফাইল সাইজ 10MB এর চেয়ে কম হতে হবে।");
                return;
            }
            if (!selectedFile.type.startsWith('image/')) {
                setError("প্লিজ একটি valid image file সিলেক্ট করুন।");
                return;
            }
            setFile(selectedFile);
            setPreview(URL.createObjectURL(selectedFile));
            setError(null);
        }
    };

    const openCamera = () => {
        fileInputRef.current?.click();
    };

    const clearAll = () => {
        setFile(null);
        setPreview(null);
        setResult(null);
        setError(null);
        setProgress(0);
    };

    const retryDetection = () => {
        if (file) {
            handleSubmit({ preventDefault: () => {} });
        }
    };
    
    // --- Submission and Firestore Save Logic (Updated) ---
    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!file) {
            setError("প্লিজ প্রথমে একটি ছবি সিলেক্ট করুন!");
            return;
        }

        const formData = new FormData();
        formData.append("image", file);

        let progressInterval;
        try {
            setLoading(true);
            setResult(null);
            setError(null);
            setProgress(0);

            progressInterval = setInterval(() => {
                setProgress(prev => Math.min(prev + Math.random() * 30, 90));
            }, 200);

            // Use exponential backoff for retries
            const maxRetries = 3;
            let res;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    res = await axios.post("http://localhost:8080/api/detect-currency", formData, {
                        headers: { "Content-Type": "multipart/form-data" },
                        timeout: 30000,
                    });
                    break; // Success, break out of loop
                } catch (err) {
                    if (i === maxRetries - 1) throw err; // Throw on last retry
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000)); // Exponential backoff
                }
            }

            clearInterval(progressInterval);
            setProgress(100);
            setResult(res.data);

            // --- SAVE HISTORY TO FIRESTORE ---
            if (res.data.success || res.data.currencyCode) {
                if (db && userId) {
                    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                    // Use Firestore path for private user data
                    const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/currency_detections`);
                    
                    const newHistoryItem = {
                        rawTimestamp: new Date(), // Saves as Firestore Timestamp
                        result: res.data
                    };

                    await addDoc(historyCollectionRef, newHistoryItem)
                        .then(() => console.log("History item saved to Firestore."))
                        .catch(e => console.error("Failed to save history to Firestore:", e));
                    
                    // The history state will be updated by the onSnapshot listener
                } else {
                    console.warn("Firestore not ready. History not saved online.");
                }
            }
            // --- END SAVE HISTORY ---

        } catch (error) {
            console.error(error);
            clearInterval(progressInterval);
            setProgress(0);

            if (error.response) {
                if (error.response.status === 400) {
                    setError("প্লিজ প্রথমে একটি ছবি সিলেক্ট করুন!");
                } else if (error.response.data?.details?.includes('GEMINI_API_KEY')) {
                    setError("AI Detection Unavailable: Backend সার্ভারে GEMINI_API_KEY configure করুন।");
                } else {
                    setError(`সার্ভার Error (${error.response.status}): ${error.response.data?.error || 'Detection failed'}`);
                }
            } else if (error.request) {
                setError("Network Error: প্লিজ চেক করুন backend সার্ভার port 8080 এ running আছে কি না।");
            } else if (error.code === 'ECONNABORTED') {
                setError("Request Timeout: ছবি প্রসেসিং অনেক সময় নিল। একটি ছোট ছবি চেষ্টা করুন।");
            } else {
                setError(`Error: ${error.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    // --- UI Rendering ---
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-sans">
            {/* Header */}
            <div className="bg-white shadow-lg border-b sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="flex items-center space-x-3">
                            <div className="text-3xl text-green-600">💵</div>
                            <div>
                                <h1 className="text-xl font-extrabold text-gray-900">Currency Detector</h1>
                                <p className="text-sm text-gray-500">AI-Powered Currency Recognition</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            {/* User Status and Logout */}
                            <div className="text-sm">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${isAnonymous ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                    {isAuthReady ? (
                                        isAnonymous ? '👤 Anonymous User' : '✅ Authenticated User'
                                    ) : (
                                        '⏳ Connecting...'
                                    )}
                                </span>
                                {userId && (
                                    <p className="hidden md:block text-xs text-gray-500 mt-1 truncate max-w-[150px]" title={userId}>
                                        UID: {userId}
                                    </p>
                                )}
                            </div>

                            {/* Logout Button */}
                            {userId && (
                                <button
                                    onClick={handleLogout}
                                    className="px-3 py-1 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors shadow-md"
                                    disabled={!isAuthReady}
                                >
                                    Log out
                                </button>
                            )}

                            {history.length > 0 && (
                                <span className="text-sm text-gray-500 hidden sm:block">{history.length} detections</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Upload Section */}
                        <div className="bg-white rounded-xl shadow-2xl p-6">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-2">আপনার মুদ্রার ছবি আপলোড করুন</h2>

                            <div
                                className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 ${
                                    dragActive ? 'border-blue-600 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
                                }`}
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    capture="environment"
                                />

                                {preview ? (
                                    <div className="space-y-6">
                                        <div className="relative">
                                            <img
                                                src={preview}
                                                alt="preview"
                                                className="max-w-full h-64 object-contain mx-auto rounded-xl shadow-xl border border-gray-200"
                                            />
                                        </div>
                                        <div className="bg-green-50 p-4 rounded-xl text-center border border-green-200">
                                            <p className="text-green-800 font-bold text-lg">✅ ছবি সফলভাবে আপলোড হয়েছে!</p>
                                            <p className="text-green-600 text-sm mt-1">বিশ্লেষণ শুরু করতে নিচের "মুদ্রা চিনুন" বাটনটি ক্লিক করুন</p>
                                        </div>
                                        <div className="flex justify-center space-x-4">
                                            <button
                                                onClick={openCamera}
                                                className="px-6 py-2 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-colors font-medium shadow-md"
                                            >
                                                📷 ছবি পরিবর্তন করুন
                                            </button>
                                            <button
                                                onClick={clearAll}
                                                className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium shadow-md"
                                            >
                                                🗑️ সাফ করুন
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="text-7xl text-blue-500 animate-pulse">🖼️</div>
                                        <div>
                                            <p className="text-xl font-bold text-gray-700 mb-2">Drag and Drop Your Currency Image Here</p>
                                            <p className="text-lg font-medium text-gray-700 mb-1">অথবা</p>
                                            <button
                                                onClick={openCamera}
                                                className="px-10 py-4 mt-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-300 font-extrabold text-xl shadow-xl hover:shadow-2xl transform hover:scale-[1.02]"
                                            >
                                                📷 ছবি সিলেক্ট করুন
                                            </button>
                                            <p className="text-xs text-gray-500 mt-3">
                                                Supports: JPG, PNG, WebP (max 10MB)
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {file && preview && (
                                <div className="mt-8 text-center">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={loading}
                                        className={`w-full max-w-sm px-8 py-4 rounded-xl font-extrabold transition-all duration-300 text-xl ${
                                            loading
                                                ? 'bg-gray-400 cursor-not-allowed'
                                                : 'bg-green-600 hover:bg-green-700 hover:scale-[1.03] text-white shadow-2xl transform'
                                        }`}
                                    >
                                        {loading ? (
                                            <div className="flex items-center justify-center space-x-3">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                                                <span>মুদ্রা বিশ্লেষণ করছি...</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <span>🔍</span>
                                                <span>মুদ্রা চিনুন</span>
                                            </div>
                                        )}
                                    </button>
                                </div>
                            )}

                            {loading && (
                                <div className="mt-6">
                                    <div className="bg-gray-200 rounded-full h-3">
                                        <div
                                            className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-linear"
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-2 text-center">ছবি প্রসেস করছি... {Math.round(progress)}%</p>
                                </div>
                            )}

                            {error && (
                                <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-lg shadow-inner">
                                    <div className="flex items-start space-x-3">
                                        <div className="text-red-500 mt-0.5 text-xl">⚠️</div>
                                        <div className="flex-1">
                                            <p className="text-red-800 font-bold">Detection Error</p>
                                            <p className="text-red-600 text-sm mt-1">{error}</p>
                                            {(error.includes('Network Error') || error.includes('Timeout')) && (
                                                <div className="mt-3">
                                                    <button
                                                        onClick={retryDetection}
                                                        className="text-sm bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 transition-colors shadow-md"
                                                    >
                                                        পুনরায় চেষ্টা করুন
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Results Section */}
                        {result && (
                            <div className="bg-white rounded-xl shadow-2xl p-6">
                                <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-2">🔍 চিনতে পারা মুদ্রা</h2>

                                {result.currencyCode ? (
                                    <div className="space-y-6">
                                        {/* Main Info */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-green-50 p-5 rounded-xl border border-green-300 shadow-lg">
                                                <h3 className="text-xl font-bold text-green-800 mb-3 flex items-center">
                                                    <span className="mr-3">✅</span>
                                                    মুদ্রা তথ্য
                                                </h3>
                                                <div className="space-y-2 text-lg">
                                                    <p className="text-gray-800">
                                                        <span className="font-semibold">কোড:</span> {result.currencyCode}
                                                    </p>
                                                    <p className="text-gray-800">
                                                        <span className="font-semibold">নাম:</span> {result.currencyName || result.currencyCode}
                                                    </p>
                                                    <p className="text-gray-800">
                                                        <span className="font-semibold">চিহ্ন:</span> {result.symbol}
                                                    </p>
                                                    <p className="text-gray-800">
                                                        <span className="font-semibold">দেশ:</span> {result.country}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="bg-blue-50 p-5 rounded-xl border border-blue-300 shadow-lg">
                                                <h3 className="text-xl font-bold text-blue-800 mb-3 flex items-center">
                                                    <span className="mr-3">📊</span>
                                                    Detection বিস্তারিত
                                                </h3>
                                                <div className="space-y-3">
                                                    <div>
                                                        <span className="font-semibold text-gray-800 text-lg">Confidence:</span>
                                                        <span
                                                            className={`ml-3 px-3 py-1.5 rounded-full text-sm font-bold ${
                                                                result.confidence === 'very_high'
                                                                    ? 'bg-green-200 text-green-800'
                                                                    : result.confidence === 'high'
                                                                    ? 'bg-blue-200 text-blue-800'
                                                                    : result.confidence === 'medium'
                                                                    ? 'bg-yellow-200 text-yellow-800'
                                                                    : 'bg-red-200 text-red-800'
                                                            }`}
                                                        >
                                                            {result.confidence.replace(/_/g, ' ').toUpperCase()}
                                                        </span>
                                                    </div>
                                                    {result.percentage && (
                                                        <div>
                                                            <span className="font-semibold text-gray-800 text-lg">নির্ভুলতা:</span>
                                                            <span className="ml-3 px-3 py-1.5 rounded-full text-sm font-bold bg-purple-200 text-purple-800">
                                                                {result.percentage}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Detection Reason */}
                                        {result.reason && (
                                            <div className="bg-yellow-50 p-5 rounded-xl border border-yellow-300 shadow-md">
                                                <h3 className="text-lg font-bold text-yellow-800 mb-2 flex items-center">
                                                    <span className="mr-2 text-xl">💡</span>
                                                    Detection কারণ
                                                </h3>
                                                <p className="text-gray-800">{result.reason}</p>
                                            </div>
                                        )}

                                        {/* Validation Points */}
                                        {result.details?.validation_points && result.details.validation_points.length > 0 && (
                                            <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-300 shadow-md">
                                                <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center">
                                                    <span className="mr-2 text-xl">🔍</span>
                                                    Validation Points
                                                </h3>
                                                <ul className="space-y-2 list-none p-0 m-0">
                                                    {result.details.validation_points.map((point, idx) => (
                                                        <li key={idx} className="flex items-start space-x-3 text-gray-800">
                                                            <span className="text-emerald-600 font-extrabold mt-0.5">✓</span>
                                                            <span className="flex-1">{point}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        
                                        {/* Extracted Text */}
                                        {result.extractedText && (
                                            <div className="bg-gray-100 p-5 rounded-xl border border-gray-300 shadow-inner">
                                                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center">
                                                    <span className="mr-2 text-xl">📝</span>
                                                    Extract করা টেক্সট
                                                </h3>
                                                <p className="text-gray-700 text-sm font-mono bg-white p-4 rounded-lg border break-words shadow-sm">
                                                    {result.extractedText}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-red-50 p-5 rounded-xl border border-red-300 shadow-md">
                                        <h3 className="text-xl font-bold text-red-800 mb-3 flex items-center">
                                            <span className="mr-2 text-xl">❌</span>
                                            কোন মুদ্রা চিনতে পারা যায়নি
                                        </h3>
                                        <p className="text-gray-800">ছবিটি আরও স্পষ্ট করে পুনরায় চেষ্টা করুন।</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Instructions */}
                        <div className="bg-white rounded-xl shadow-2xl p-6">
                            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">
                                <span className="mr-2">📋</span>
                                কিভাবে ব্যবহার করবেন
                            </h3>
                            <div className="space-y-3 text-sm text-gray-600">
                                <div className="flex items-start space-x-3">
                                    <span className="text-blue-600 mt-0.5 font-extrabold text-lg">1.</span>
                                    <span>মুদ্রার একটি স্পষ্ট ছবি আপলোড বা drag করুন</span>
                                </div>
                                <div className="flex items-start space-x-3">
                                    <span className="text-blue-600 mt-0.5 font-extrabold text-lg">2.</span>
                                    <span>"মুদ্রা চিনুন" বাটন ক্লিক করুন</span>
                                </div>
                                <div className="flex items-start space-x-3">
                                    <span className="text-blue-600 mt-0.5 font-extrabold text-lg">3.</span>
                                    <span>AI বিশ্লেষণের ফলাফল এবং ঐতিহাসিক তথ্য দেখুন</span>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-gray-200">
                                <h4 className="font-bold text-gray-800 mb-2">💡 সেরা ফলাফলের জন্য টিপস:</h4>
                                <ul className="text-xs text-gray-600 space-y-1 pl-4 list-disc">
                                    <li>ভাল আলো এবং সমতল পৃষ্ঠ ব্যবহার করুন</li>
                                    <li>মুদ্রার টেক্সট/সিম্বল স্পষ্ট হওয়া নিশ্চিত করুন</li>
                                    <li>মুদ্রাটি ফ্রেমের কেন্দ্রে রাখুন</li>
                                </ul>

                                <div className="mt-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                                    <p className="text-xs text-yellow-900">
                                        <strong>⚠️ Note:</strong> এই অ্যাপে আপনার **detection history** ক্লাউডে সেভ করার জন্য **Firebase Firestore** ব্যবহার করা হয়েছে।
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Recent Detections (Firestore Integrated) */}
                        <div className="bg-white rounded-xl shadow-2xl p-6">
                            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">
                                <span className="mr-2">🕒</span>
                                সম্প্রতি চেনা মুদ্রা (History)
                            </h3>
                            <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                                {isAuthReady && userId ? (
                                    history.length > 0 ? (
                                        history.map((item) => (
                                            <div key={item.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="font-bold text-sm text-green-700">
                                                        {item.result.currencyCode || 'UNKNOWN'}
                                                    </span>
                                                    <span className="text-xs text-gray-500">{item.timestamp}</span>
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                    {item.result.country || 'N/A'} •{' '}
                                                    <span className={`font-medium ${item.result.confidence === 'very_high' ? 'text-green-600' : 'text-orange-600'}`}>
                                                        {item.result.confidence?.replace(/_/g, ' ').toUpperCase()}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-500 text-sm italic">এখানে আপনার ডিটেকশন হিস্টরি দেখাবে।</p>
                                    )
                                ) : (
                                    <div className="p-4 bg-yellow-50 rounded-lg text-center">
                                        <p className="text-yellow-800 text-sm font-medium">Authentication is loading...</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Supported Currencies */}
                        <div className="bg-white rounded-xl shadow-2xl p-6">
                            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">
                                <span className="mr-2">🌍</span>
                                সমর্থিত মুদ্রা
                            </h3>
                            <div className="grid grid-cols-3 gap-3 text-sm">
                                {[
                                    'USD ($)', 'EUR (€)', 'GBP (£)', 'JPY (¥)',
                                    'INR (₹)', 'BDT (৳)', 'CAD (C$)', 'AUD (A$)',
                                    'CNY (¥)', 'CHF (CHF)', 'KRW (₩)', 'BRL (R$)',
                                    'AED (د.إ)', 'SAR (ر.س)', 'RUB (₽)'
                                ].map((currency) => (
                                    <div key={currency} className="flex items-center space-x-1 p-1 bg-gray-100 rounded-md">
                                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                                        <span className="text-gray-700 text-xs font-medium">{currency}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-3 font-semibold text-center">+ এআই দ্বারা আরও অনেক মুদ্রা চিনতে পারে</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
