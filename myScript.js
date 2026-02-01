import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, remove, get } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

// --- STATE ---

// --- FIREBASE CONFIG ---
// TODO: Replace with your specific Firebase Project Config Keys
const firebaseConfig = {
	apiKey: "AIzaSyBM7oB0EkTjGJiOHdo67ByXA6qxVcvPS8Y",
	authDomain: "engrar3d.firebaseapp.com",
	databaseURL: "https://engrar3d-default-rtdb.europe-west1.firebasedatabase.app",
	projectId: "engrar3d",
	storageBucket: "engrar3d.firebasestorage.app",
	messagingSenderId: "68298863793",
	appId: "1:68298863793:web:ba7ec7ded3424b4c779e90",
	measurementId: "G-NLSV32JMM2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'europe-west1');

const ENGRARE_LOGO_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M12.0196 14.9374C11.7284 14.9374 11.4307 14.9818 11.1784 15.0796C11.0546 15.1275 10.9032 15.2031 10.7699 15.3252C10.6361 15.4479 10.4632 15.6749 10.4632 15.9999C10.4632 16.3249 10.6361 16.5519 10.7699 16.6745C10.9032 16.7967 11.0546 16.8722 11.1784 16.9202C11.4307 17.018 11.7284 17.0624 12.0196 17.0624C12.3109 17.0624 12.6085 17.018 12.8609 16.9202C12.9846 16.8722 13.136 16.7967 13.2693 16.6745C13.4032 16.5519 13.5761 16.3249 13.5761 15.9999C13.5761 15.6749 13.4032 15.4479 13.2693 15.3252C13.136 15.2031 12.9846 15.1275 12.8609 15.0796C12.6085 14.9818 12.3109 14.9374 12.0196 14.9374Z" fill="#1C274C"/>
<path d="M14.0365 12.6464C14.2015 12.38 14.5274 12.0625 15.0163 12.0625C15.5051 12.0625 15.831 12.38 15.996 12.6464C16.1681 12.9243 16.2501 13.2612 16.2501 13.5938C16.2501 13.9263 16.1681 14.2632 15.996 14.5411C15.831 14.8075 15.5051 15.125 15.0163 15.125C14.5274 15.125 14.2015 14.8075 14.0365 14.5411C13.8644 14.2632 13.7824 13.9263 13.7824 13.5938C13.7824 13.2612 13.8644 12.9243 14.0365 12.6464Z" fill="#1C274C"/>
<path d="M9.01634 12.0625C8.52751 12.0625 8.20161 12.38 8.03658 12.6464C7.86445 12.9243 7.78247 13.2612 7.78247 13.5938C7.78247 13.9263 7.86445 14.2632 8.03658 14.5411C8.20161 14.8075 8.52751 15.125 9.01634 15.125C9.50518 15.125 9.83108 14.8075 9.9961 14.5411C10.1682 14.2632 10.2502 13.9263 10.2502 13.5938C10.2502 13.2612 10.1682 12.9243 9.9961 12.6464C9.83108 12.38 9.50518 12.0625 9.01634 12.0625Z" fill="#1C274C"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M6.09485 4.25C5.48148 4.25 4.77463 4.42871 4.20882 4.91616C3.62226 5.4215 3.27004 6.18781 3.27004 7.1875V9.0625L3.27005 9.06545C3.2712 9.35941 3.3211 9.94757 3.4888 10.4392C3.54365 10.6001 3.63129 10.8134 3.77764 11.0058C3.49364 11.5688 3.35904 12.1495 3.29787 12.7095C3.2468 13.1771 3.24611 13.6679 3.25424 14.1211C2.5932 14.3507 1.90877 14.6349 1.5932 14.8387C1.24524 15.0634 1.14534 15.5277 1.37006 15.8756C1.59478 16.2236 2.05903 16.3235 2.40698 16.0988C2.5234 16.0236 2.86686 15.8664 3.31867 15.6939C3.38755 16.173 3.52716 16.6095 3.7221 17.0063C3.56621 17.1035 3.42847 17.1935 3.31889 17.2652C3.27694 17.2926 3.23912 17.3173 3.20599 17.3387C2.85803 17.5634 2.75813 18.0277 2.98285 18.3756C3.20757 18.7236 3.67182 18.8235 4.01978 18.5988C4.0609 18.5722 4.10473 18.5436 4.15098 18.5134C4.28216 18.4278 4.43287 18.3294 4.59701 18.2288C5.18653 18.8313 5.91865 19.2964 6.67916 19.6462C8.45998 20.4654 10.569 20.75 12.0001 20.75C13.4311 20.75 15.5402 20.4654 17.321 19.6462C18.0815 19.2964 18.8136 18.8313 19.4031 18.2288C19.5673 18.3294 19.718 18.4278 19.8491 18.5134C19.8954 18.5436 19.9392 18.5722 19.9803 18.5988C20.3283 18.8235 20.7925 18.7236 21.0173 18.3756C21.242 18.0277 21.1421 17.5634 20.7941 17.3387C20.761 17.3173 20.7232 17.2926 20.6812 17.2652C20.5716 17.1935 20.4339 17.1035 20.2781 17.0063C20.473 16.6095 20.6127 16.173 20.6815 15.6938C21.1335 15.8663 21.4771 16.0236 21.5936 16.0988C21.9415 16.3235 22.4058 16.2236 22.6305 15.8756C22.8552 15.5277 22.7553 15.0634 22.4074 14.8387C22.0917 14.6349 21.4071 14.3506 20.7459 14.121C20.7541 13.6678 20.7534 13.177 20.7023 12.7095C20.6412 12.1495 20.5065 11.5688 20.2225 11.0058C20.3689 10.8134 20.4565 10.6001 20.5114 10.4392C20.6791 9.94758 20.729 9.35941 20.7301 9.06545L20.7302 9.0625V7.18761C20.7302 6.18792 20.3779 5.42162 19.7914 4.91628C19.2256 4.42882 18.5187 4.25011 17.9054 4.25011C17.4969 4.25011 17.0744 4.40685 16.7337 4.56076C16.3726 4.72392 15.9952 4.9359 15.6558 5.13136C15.5828 5.17339 15.5119 5.21444 15.443 5.25432L15.441 5.25548C15.177 5.4084 14.9427 5.5441 14.7339 5.65167C14.6042 5.7185 14.5035 5.7643 14.4285 5.79206C14.3969 5.80377 14.3767 5.80966 14.3663 5.81242C14.1129 5.81102 13.9514 5.79033 13.7181 5.76044C13.6681 5.75403 13.6147 5.74719 13.5564 5.74003C13.2098 5.69743 12.7722 5.65636 12.0001 5.65636C11.228 5.65636 10.7905 5.69743 10.4438 5.74003C10.3855 5.74719 10.3322 5.75403 10.2821 5.76044C10.0489 5.79033 9.88738 5.81102 9.63388 5.81242C9.62352 5.80966 9.60332 5.80376 9.57174 5.79206C9.49678 5.7643 9.39604 5.71849 9.26633 5.65166C9.05755 5.54408 8.82331 5.40842 8.55926 5.25548C8.48975 5.21523 8.41818 5.17377 8.34446 5.13132C8.00502 4.93584 7.62764 4.72384 7.26652 4.56067C6.92587 4.40675 6.50329 4.25 6.09485 4.25ZM6.16192 17.6138C6.49595 17.8657 6.8808 18.0879 7.30604 18.2835C8.83694 18.9877 10.7179 19.25 12.0001 19.25C13.2823 19.25 15.1632 18.9877 16.6941 18.2835C17.1194 18.0879 17.5042 17.8657 17.8382 17.6138C17.4858 17.5524 17.2179 17.245 17.2179 16.875C17.2179 16.4608 17.5537 16.125 17.9679 16.125C18.2951 16.125 18.6295 16.2068 18.9399 16.3204C19.0985 15.9885 19.1959 15.625 19.2226 15.2271C18.9249 15.1544 18.7193 15.125 18.6134 15.125C18.1992 15.125 17.8634 14.7892 17.8634 14.375C17.8634 13.9608 18.1992 13.625 18.6134 13.625C18.8081 13.625 19.0284 13.6542 19.2504 13.6974C19.2505 13.4213 19.2415 13.1502 19.2112 12.8724C19.1407 12.227 18.958 11.6541 18.5269 11.1447C18.3727 10.9625 18.1809 10.7813 17.9402 10.6045C17.6063 10.3594 17.5344 9.88999 17.7796 9.55611C18.0247 9.22224 18.4941 9.15031 18.828 9.39546C18.9471 9.48292 19.0597 9.57282 19.1659 9.66506C19.2099 9.43686 19.2295 9.19817 19.2302 9.06087V7.18761C19.2302 6.56231 19.0238 6.23486 18.8123 6.0527C18.5801 5.85266 18.2496 5.75011 17.9054 5.75011C17.835 5.75011 17.659 5.78868 17.3513 5.92771C17.064 6.0575 16.7432 6.23612 16.4043 6.43125C16.3407 6.4679 16.2759 6.50544 16.2106 6.54328C15.9428 6.69843 15.666 6.85883 15.4209 6.98509C15.2663 7.06473 15.1052 7.14099 14.9495 7.19867C14.8058 7.25192 14.607 7.3125 14.3941 7.3125C14.0223 7.3125 13.7617 7.27877 13.5115 7.2464C13.4654 7.24043 13.4196 7.23449 13.3735 7.22883C13.0848 7.19336 12.7084 7.15636 12.0001 7.15636C11.2919 7.15636 10.9154 7.19336 10.6267 7.22883C10.5807 7.23449 10.5349 7.24042 10.4887 7.24649C10.2386 7.27877 9.97796 7.3125 9.6061 7.3125C9.39326 7.3125 9.19445 7.25191 9.05069 7.19866C8.89497 7.14098 8.73386 7.06471 8.57928 6.98506C8.33423 6.8588 8.05742 6.69839 7.78968 6.54325C7.72435 6.50539 7.65955 6.46784 7.59589 6.43118C7.25702 6.23603 6.93614 6.05741 6.64888 5.92761C6.34115 5.78856 6.16522 5.75 6.09485 5.75C5.75062 5.75 5.42007 5.85254 5.18787 6.05259C4.97643 6.23475 4.77004 6.56219 4.77004 7.1875V9.06088C4.7707 9.19819 4.79025 9.43686 4.83425 9.66506C4.94053 9.57281 5.05309 9.48292 5.1722 9.39546C5.50608 9.15031 5.97547 9.22224 6.22062 9.55612C6.46577 9.88999 6.39385 10.3594 6.05997 10.6045C5.81926 10.7813 5.62748 10.9625 5.47331 11.1447C5.04223 11.6541 4.85949 12.227 4.789 12.8724C4.75865 13.1502 4.74966 13.4213 4.74975 13.6975C4.97192 13.6543 5.19231 13.625 5.38719 13.625C5.80141 13.625 6.13719 13.9608 6.13719 14.375C6.13719 14.7892 5.80141 15.125 5.38719 15.125C5.28121 15.125 5.07549 15.1544 4.77758 15.2271C4.80434 15.625 4.90168 15.9885 5.06027 16.3203C5.37069 16.2068 5.70504 16.125 6.03224 16.125C6.44646 16.125 6.78224 16.4608 6.78224 16.875C6.78224 17.245 6.51433 17.5524 6.16192 17.6138Z" fill="#1C274C"/>
</svg>`;

const DEFAULT_LOGO_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor"/></svg>`;

let activeModelConfig = null;
let currentLibraryModel = null;
let originalModelConfig = null; // NEW: Store original config for reset
let scene, camera, renderer, mesh, controls;
let cart = [];
// --- MODAL STATE ---
let currentModalStl = "";
let currentModalName = "";
let currentModalId = null;
let currentModalImages = [];
let currentImageIndex = 0;

const BASE_PRICE_PER_CM3 = 15.00; 
const BUILD_VOLUME_X = 256;
const BUILD_VOLUME_Y = 256;

// --- LOCAL MODELS DATA ---
const allFirebaseModels = [
    {
        id: 1,
        name: "Dik Duran Kişiye Özel Ad Plakası",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/products/1/1.jpg", "./content/products/1/2.jpg", "./content/products/1/3.jpg", "./content/products/1/4.jpg"],
        stl: "./content/products/1/desktop_writing_holder.STL",
        sellCount: 10,
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0, z: 2 },
            alignmentConfig: { axis: 'x', min: -100, max: 100 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 19,       
                fontThickness: 4,
                letterSpacing: 3,
                alignment: "Right",   
                position: { x: -35, y: -20, z: 0 },
                rotation: { x: Math.PI / 2, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            logo: {
                content: ENGRARE_LOGO_SVG,
                scale: 2.1,
                depth: 4,
                color: "#ff0000",
                position: { x: -70, y: -20, z: 0 },
                rotation: { x: Math.PI / 2, y: 0, z: 0 }
            },
            customizableParams: { //0: Never visible. 1: Always visible (Basic & Pro). 2: Visible only in 'advanced' (Pro) mode.
                textContent: 1,
                textFont: 1,
                textSize: 1,
                textDepth: 2,
                letterSpacing: 2,
                textAlignment: 1,
                textColor: 1,
                textRotationX: 0,
                textRotationY: 0,
                textRotationZ: 2,
                textPositionX: 2,
                textPositionY: 0,
                textPositionZ: 2,
                logo: 1,
                logoSize: 1,
                logoDepth: 2,
                logoColor: 1,
                logoRotationX: 0,
                logoRotationY: 0,
                logoRotationZ: 2,
                logoPositionX: 2,
                logoPositionY: 0,
                logoPositionZ: 2,
                modelColor: 1,
                material: 2,
                infill: 2,
                quantity: 1,
                delivery: 1
            }
        }
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/products/2/1.jpg", "./content/products/2/2.jpg", "./content/products/2/3.jpg"],
        stl: "./content/products/2/sign.STL",
        sellCount: 50,
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 23,       
                fontThickness: 4,
                letterSpacing: 2,
                alignment: "center",   
                position: { x: 0, y: 0, z: 30 },
                rotation: { x: Math.PI / 2, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            logo: {
                content: ENGRARE_LOGO_SVG,
                scale: 2.2,
                depth: 2,
                color: "#FFFFFF",
                position: { x: 0, y: 0, z: -22 },
                rotation: { x: Math.PI / 2, y: 0, z: 0 }
            },
            customizableParams: {
                textContent: 1,
                textFont: 1,
                textSize: 1,
                textDepth: 1,
                letterSpacing: 0,
                textAlignment: 1,
                textColor: 1,
                textRotationX: 0,
                textRotationY: 0,
                textRotationZ: 2,
                textPositionX: 2,
                textPositionY: 0,
                textPositionZ: 2,
                logo: 1,
                logoSize: 1,
                logoDepth: 0,
                logoColor: 1,
                logoRotationX: 0,
                logoRotationY: 0,
                logoRotationZ: 2,
                logoPositionX: 2,
                logoPositionY: 0,
                logoPositionZ: 2,
                modelColor: 1,
                material: 2,
                infill: 2,
                quantity: 1,
                delivery: 1
            }
        }
    },
    {
        id: 3,
        name: "Kalemlik",
        desc: "Yüksek detaylı istenilen renge kişiselleştirilebilen ürün.",
        price: 180,
        images: ["./content/products/3/1.jpg"], 
        stl: "./content/products/3/kalemlik.STL",
        sellCount: 5,
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,
                letterSpacing: 0,
                alignment: "center",   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            logo: {
                content: ENGRARE_LOGO_SVG,
                scale: 1,
                depth: 2,
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            },
            customizableParams: {
                textContent: 0,
                textFont: 0,
                textSize: 1,
                textDepth: 1,
                letterSpacing: 0,
                textAlignment: 0,
                textColor: 1,
                textRotationX: 1,
                textRotationY: 0,
                textRotationZ: 1,
                textPositionX: 1,
                textPositionY: 1,
                textPositionZ: 0,
                logo: 1,
                logoSize: 1,
                logoDepth: 0,
                logoRotationX: 0,
                logoRotationY: 0,
                logoRotationZ: 0,
                logoPositionX: 0,
                logoPositionY: 0,
                logoPositionZ: 0,
                modelColor: 1,
                material: 1,
                infill: 1,
                quantity: 1,
                delivery: 1
            }
        }
    },
    {
        id: 4,
        name: "Dekoratif Lamba",
        desc: "Yüksek elegant görünümde dekoratif ev tipi aydınlatma.",
        price: 180,
        images: ["./content/products/4/1.jpg", "./content/products/4/2.jpg"], 
        stl: "./content/desktop_writing_holder.STL",
        sellCount: 20,
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,
                letterSpacing: 0,
                alignment: "center",   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            logo: {
                content: ENGRARE_LOGO_SVG,
                scale: 1,
                depth: 2,
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            },
            customizableParams: {
                textContent: 1,
                textFont: 1,
                textColor: 1,
                textRotationX: 1,
                textRotationY: 1,
                textRotationZ: 1,
                textPositionX: 1,
                textPositionY: 1,
                textPositionZ: 1,
                logo: 0,
                logoSize: 0,
                logoDepth: 0,
                logoRotationX: 0,
                logoRotationY: 0,
                logoRotationZ: 0,
                logoPositionX: 0,
                logoPositionY: 0,
                logoPositionZ: 0,
                modelColor: 1,
                material: 1,
                infill: 1,
                quantity: 1,
                delivery: 1
            }
        }
    },
    {
        id: 5,
        name: "Kratosun Kılıcı",
        desc: "Renkli baskıya hazır Kreotosun Kılıcı",
        price: 180,
        images: ["./content/products/5/1.jpeg", "./content/products/5/2.jpeg"], 
        stl: "./content/desktop_writing_holder.STL",
        sellCount: 20,
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,
                letterSpacing: 0,
                alignment: "center",   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            logo: {
                content: ENGRARE_LOGO_SVG,
                scale: 1,
                depth: 2,
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            },
            customizableParams: {
                textContent: 1,
                textFont: 1,
                textColor: 1,
                textRotationX: 1,
                textRotationY: 1,
                textRotationZ: 1,
                textPositionX: 1,
                textPositionY: 1,
                textPositionZ: 1,
                logo: 0,
                logoSize: 0,
                logoDepth: 0,
                logoRotationX: 0,
                logoRotationY: 0,
                logoRotationZ: 0,
                logoPositionX: 0,
                logoPositionY: 0,
                logoPositionZ: 0,
                modelColor: 1,
                material: 1,
                infill: 1,
                quantity: 1,
                delivery: 1
            }
        }
    }
];

const USER_UPLOAD_CONFIG = {
    baseScale: { x: 1, y: 1, z: 1 }, 
    text: {
        initialContent: "",
        fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
        fontSize: 10,
        fontThickness: 4,
        letterSpacing: 0,
        alignment: "center",
        position: { x: 0, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "#FFFFFF"
    },
    logo: {
        content: null,
        scale: 1,
        depth: 2,
        color: "#FFFFFF",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }
    },
    customizableParams: {
        // 1: Basic, 2: Pro, 0: Hidden
        modelColor: 1,
        material: 1,
        infill: 1,
        quantity: 1,
        delivery: 1,
        
        textContent: 1,
        textFont: 1,
        textSize: 1,
        textDepth: 1,
        letterSpacing: 1,
        textAlignment: 1,
        textColor: 1,
        textRotationX: 1,
        textRotationY: 1,
        textRotationZ: 1,
        textPositionX: 1,
        textPositionY: 1,
        textPositionZ: 1,

        logo: 1,
        logoSize: 1,
        logoDepth: 1,
        logoColor: 1,
        logoRotationX: 1,
        logoRotationY: 1,
        logoRotationZ: 1,
        logoPositionX: 1,
        logoPositionY: 1,
        logoPositionZ: 1
    }
};

// --- DOM READY ---
$(document).ready(function() {
    loadCart();
    init3D(); 
    renderModelsPage(allFirebaseModels);
    renderHomeLibrary();

    // Handle Initial URL State
    const path = window.location.search.replace('?', '');
    if (path) {
        const map = {
            'home': '#home-page',
            'models': '#models-page',
            'studio': '#upload-page',
            'checkout': '#checkout-page',
            'login': '#login-page',
            'dashboard': '#dashboard-page'
        };
        if (map[path]) {
            // Wait slightly for DOM/Auth if needed, or switch immediately
            switchPage(map[path], false); 
        }
    }

    // Handle Back Button
    window.addEventListener('popstate', function(event) {
        if (event.state && event.state.page) {
            switchPage(event.state.page, false);
        } else {
            switchPage('#home-page', false);
        }
    });

    // --- FIREBASE AUTH LISTENERS ---
    
    // 1. Sign Up
    // Initialize Flatpickr
    flatpickr("#signup-dob", {
        locale: "tr",
        dateFormat: "d F Y",
        disableMobile: "true", // Force custom picker on mobile too for consistency
        theme: "airbnb" // You might need to import a theme css or just rely on base
    });

    let selectedProfilePhoto = { type: 'default', src: './content/default_user.png' }; // Store selection state

    // Profile Photo UI Listeners
    
    // A. Option Buttons (Default & Icons)
    $('.profile-option-btn').click(function() {
        // Visual Selection
        $('.profile-option-btn').removeClass('selected');
        $(this).addClass('selected');

        const type = $(this).data('type');
        const $previewBox = $('#profile-preview-box');
        const $previewImg = $('#signup-profile-preview');
        const $previewIcon = $('#signup-profile-icon');
        
        if (type === 'default') {
            const src = $(this).data('src');
            
            // Switch to Img mode
            $previewIcon.hide();
            $previewImg.attr('src', src).show();
            $previewBox.css('background-color', '#f8fafc'); // Reset bg

            selectedProfilePhoto = { type: 'default', src: src };
            $('#upload-file-name').hide();
        } 
        else if (type === 'icon') {
            const iconUnicode = $(this).data('icon'); 
            const color = $(this).data('color') || '#3b82f6';
            const iconClass = $(this).find('i').attr('class'); // Get class from button
            
            // Switch to Icon mode
            $previewImg.hide();
            $previewIcon.attr('class', iconClass).css('color', 'white').show();
            $previewBox.css('background-color', color); // Set bg to icon color

            // Generate Avatar on Canvas (for actual upload)
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');

            // Background
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 200, 200);

            // Wait for font to ensure it renders (basic check)
            document.fonts.ready.then(() => {
                ctx.font = '900 100px "Font Awesome 6 Free"'; 
                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Convert hex unicode to char
                const char = String.fromCharCode(parseInt(iconUnicode, 16));
                ctx.fillText(char, 100, 100);

                const dataUrl = canvas.toDataURL('image/png');
                selectedProfilePhoto = { type: 'generated', dataUrl: dataUrl };
            });

            $('#upload-file-name').hide();
        }
    });

    // B. Upload Button Trigger
    $('#profile-upload-trigger').click(function() {
        $('#signup-file-input').click();
    });

    // C. File Input Change
    $('#signup-file-input').change(function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const $previewBox = $('#profile-preview-box');
                const $previewImg = $('#signup-profile-preview');
                const $previewIcon = $('#signup-profile-icon');

                // Switch to Img mode
                $previewIcon.hide();
                $previewImg.attr('src', e.target.result).show();
                $previewBox.css('background-color', '#f8fafc');

                selectedProfilePhoto = { type: 'upload', file: file };
                
                $('#upload-file-name').text("Seçilen: " + file.name).show();
                
                // Visual updates
                $('.profile-option-btn').removeClass('selected');
                $('#profile-upload-trigger').css('border-color', 'var(--accent)').css('color', 'var(--accent)');
            }
            reader.readAsDataURL(file);
        }
    });

    $('#btn-signup').click(async () => {
        const $btn = $('#btn-signup');
        const originalBtnText = $btn.text();
        
        const fullname = $('#signup-fullname').val();
        const username = $('#signup-username').val();
        const dob = $('#signup-dob').val(); // Flatpickr updates this value
        const email = $('#signup-email').val();
        const pass = $('#signup-password').val();
        const isKvkkChecked = $('#signup-kvkk').is(':checked');

        // Validation
        if (!fullname || !username || !dob || !email) {
            showToast("Lütfen tüm zorunlu alanları doldurun.", "error");
            return;
        }

        if (!pass) {
             showToast("Lütfen bir şifre belirleyin.", "error");
             return;
        }

        if (!isKvkkChecked) {
            showToast("Lütfen KVKK Aydınlatma Metni'ni onaylayın.", "error");
            return;
        }
        
        // Start Loading
        $btn.addClass('loading').html('<div class="spinner-border"></div>');

        // Capture Guest UID if exists
        const currentUser = auth.currentUser;
        const guestUid = (currentUser && currentUser.isAnonymous) ? currentUser.uid : null;

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
            const user = userCredential.user;
            
            let photoURL = "./content/default_user.png";

            // Handle Profile Photo Upload / Generation
            if (selectedProfilePhoto.type === 'upload' && selectedProfilePhoto.file) {
                try {
                    const storageRef = sRef(storage, `profile_photos/${user.uid}`);
                    const snapshot = await uploadBytes(storageRef, selectedProfilePhoto.file);
                    photoURL = await getDownloadURL(snapshot.ref);
                } catch (uploadErr) {
                    console.error("Photo upload failed:", uploadErr);
                    // showToast("Profil fotoğrafı yüklenemedi...", "info"); // Optional: don't block flow
                }
            } else if (selectedProfilePhoto.type === 'generated' && selectedProfilePhoto.dataUrl) {
                try {
                    const res = await fetch(selectedProfilePhoto.dataUrl);
                    const blob = await res.blob();
                    const storageRef = sRef(storage, `profile_photos/${user.uid}_avatar.png`);
                    const snapshot = await uploadBytes(storageRef, blob);
                    photoURL = await getDownloadURL(snapshot.ref);
                } catch (err) {
                    console.error("Avatar save failed", err);
                    photoURL = selectedProfilePhoto.dataUrl; // Fallback
                }
            } else if (selectedProfilePhoto.type === 'default') {
                photoURL = selectedProfilePhoto.src;
            }

            await updateProfile(user, { 
                displayName: fullname,
                photoURL: photoURL
            });
            
            // Write Extended Profile Data
            await set(ref(db, 'users/' + user.uid + '/profile'), {
                fullname: fullname,
                username: username,
                dob: dob,
                email: email,
                role: "user",
                photoURL: photoURL,
                iconPreference: selectedProfilePhoto.type === 'icon' ? selectedProfilePhoto.value : null
            });

            // Migrate Guest Data
            if (guestUid) {
                await migrateGuestData(guestUid, user.uid);
            }

            showToast("Hesap oluşturuldu! Hoş geldiniz " + fullname, "success");
            
            // Reset Form Fields
            $('#signup-fullname').val('');
            $('#signup-username').val('');
            $('#signup-dob').val(''); // Flatpickr clear might require .clear() but val('') usually works
            $('#signup-email').val('');
            $('#signup-password').val('');
            $('#signup-kvkk').prop('checked', false);
            
            // Reset Profile Selection
            $('.profile-option-btn').removeClass('selected');
            $('.profile-option-btn[data-type="default"]').addClass('selected');
            $('#signup-profile-preview').attr('src', './content/default_user.png').show();
            $('#signup-profile-icon').hide();
            $('#profile-preview-box').css('background-color', '#f8fafc');
            selectedProfilePhoto = { type: 'default', src: './content/default_user.png' };

            switchPage('#home-page');
        } catch (error) {
            showToast("Hata: " + error.message, "error");
        } finally {
            // Stop Loading
            $btn.removeClass('loading').text(originalBtnText);
        }
    });

    // 2. Sign In
    $('#btn-signin').click(async () => {
        const email = $('#signin-email').val();
        const pass = $('#signin-password').val();
        
        // Capture Guest UID if exists
        const currentUser = auth.currentUser;
        const guestUid = (currentUser && currentUser.isAnonymous) ? currentUser.uid : null;

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, pass);
            
            // Migrate Guest Data
            if (guestUid) {
                await migrateGuestData(guestUid, userCredential.user.uid);
            }

            // Alert removed for smoother UX, auth observer handles redirect
            showToast("Başarıyla giriş yapıldı.", "success");
            switchPage('#home-page');
        } catch (error) {
            showToast("Giriş Başarısız: " + error.message, "error");
        }
    });

    // 3. Log Out
    $('#action-logout').click(() => {
        signOut(auth).then(() => {
            switchPage('#home-page');
            showToast("Başarıyla çıkış yapıldı.", "success");
        });
    });

    // 4. Password Reset
    $('#btn-reset').click(async () => {
        const email = $('#reset-email').val();
        try {
            await sendPasswordResetEmail(auth, email);
            showToast("Şifre sıfırlama e-postası gönderildi!", "success");
            $('#view-reset').hide();
            $('#view-signin').fadeIn();
        } catch (error) {
            showToast("Hata: " + error.message, "error");
        }
    });

    // 5. Dashboard Tabs
    $('.dash-menu li').click(function() {
        $('.dash-menu li').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).data('tab');
        $('.dash-tab').hide();
        $(`#tab-${tab}`).fadeIn(200);
    });
    
    // --- MONITOR AUTH STATE ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Check if Anonymous (Guest) or Registered
            if (user.isAnonymous) {
                // Anonymous: Keep Login/Signup buttons visible
                $('#nav-login-btn').show();
                $('#nav-user-profile').hide();
                $('#dash-user-name').text("Konuk");
            } else {
                // Registered: Show Profile
                $('#nav-login-btn').hide();
                $('#nav-user-profile').css('display', 'flex');
                $('#dash-user-name').text(user.displayName || "Kullanıcı");
                $('#dash-user-email').text(user.email);
                if(user.photoURL) {
                    $('#nav-user-img, #dash-user-img').attr('src', user.photoURL);
                }
            }
            
            // Load Orders (for both Anon and Registered)
            loadUserOrders(user.uid);
        } else {
            // User is signed out completely -> Auto-Sign-In Anonymously
            console.log("No user, signing in anonymously...");
            signInAnonymously(auth).catch((error) => {
                console.error("Anonymous auth failed", error);
            });
        }
    });
    // 1. Navigation
	$('.nav-menu li, .nav-trigger, .dropdown-item').click(function(e) {
        e.stopPropagation(); // Prevents bubbling issues
        const target = $(this).data('target');
        if (target) switchPage(target);
    });

    // 2. Scroll to Library
    $('.scroll-trigger').click(function() {
        const target = $(this).data('scroll');
        $('html, body').animate({
            scrollTop: $(target).offset().top - 80 
        }, 800);
    });

    // 3. Search Bar Listener - LOCAL SEARCH
    $('#model-search-bar').on('input', function() {
        const query = $(this).val().trim();
        
        // If search is empty, show all models
        if (query === "") {
            renderModelsPage(allFirebaseModels);
            return;
        }
        
        // Perform local search
        const lowerQuery = query.toLowerCase();
        const results = allFirebaseModels.filter(model =>
            model.name.toLowerCase().includes(lowerQuery) ||
            model.desc.toLowerCase().includes(lowerQuery)
        );
        renderModelsPage(results);
    });

    // 4. Library Selection (Home & Models Page)
    $(document).on('click', '.library-select-btn', function(e) {
        e.stopPropagation(); // Stop the click here so it doesn't bubble up to the card
        
        const id = $(this).data('id'); 
        let model = allFirebaseModels.find(m => m.id == id);

        if (!model) {
            model = {
                id: null,
                name: $(this).data('name'),
                stl: $(this).data('stl'),
                isCustomizable: $(this).data('custom'), 
                customConfig: null
            };
        }
        openInStudio(model);
    });

    // Text Color (Round Buttons) Listener
    $('.text-color-option').click(function() { 
        // 1. Update visual selection
        $('.text-color-option').removeClass('selected'); 
        $(this).addClass('selected');
        
        // 2. Get and apply color
        const hexColor = $(this).data('hex'); 
        
        if (textMesh && textMesh.material) {
            textMesh.material.color.set(hexColor);
        }
        
        // 3. Save to config
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.color = hexColor;
        }
    });
    // NEW: Real-time Text Listener

    $('#custom-text-input').on('input', function() {
        const text = $(this).val();
        updateCustomText(text);
    });

    // Font Selection Listener
    $('#text-font-select').on('change', function() {
        const fontName = $(this).val();
        updateTextFont(fontName);
    });

    // Text Rotation Listeners - Updated for multiple axes
    $('#text-rotation-x').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-x-value').text(rotation + '°');
        updateTextRotation();
    });

    $('#text-rotation-y').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-y-value').text(rotation + '°');
        updateTextRotation();
    });

    $('#text-rotation-z').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-z-value').text(rotation + '°');
        updateTextRotation();
    });

    // Text Position X Listener
    $('#text-pos-x').on('input', function() {
        updateTextPosition();
    });

    // Text Position Y Listener
    $('#text-pos-y').on('input', function() {
        updateTextPosition();
    });

    // Text Position Z Listener
    $('#text-pos-z').on('input', function() {
        updateTextPosition();
    });

    // --- NEW TEXT CONTROLS LISTENERS ---

    // Text Size
    $('#text-size-slider, #text-size-input').on('input', function() {
        const val = parseFloat($(this).val());
        $('#text-size-slider, #text-size-input').val(val); // Sync
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.fontSize = val;
            updateCustomText( $('#custom-text-input').val() );
        }
    });

    // Text Depth (SYNCED WITH LOGO)
    $('#text-depth-slider, #text-depth-input').on('input', function() {
        const val = parseFloat($(this).val());
        $('#text-depth-slider, #text-depth-input').val(val);
        
        // Sync to Logo UI
        $('#logo-depth-slider, #logo-depth-input').val(val);

        if (activeModelConfig) {
            if (activeModelConfig.text) {
                activeModelConfig.text.fontThickness = val;
                updateCustomText( $('#custom-text-input').val() );
            }
            if (activeModelConfig.logo) {
                activeModelConfig.logo.depth = val;
                if (activeModelConfig.logo._lastSvg) {
                    updateCustomLogo(activeModelConfig.logo._lastSvg);
                }
            }
        }
    });

    // Letter Spacing (Note: TextGeometry does not support spacing natively. 
    // We will store it but might not see effect unless we implement complex mesh gen. 
    // For now, we update config)
    $('#letter-spacing-slider, #letter-spacing-input').on('input', function() {
        const val = parseFloat($(this).val());
        $('#letter-spacing-slider, #letter-spacing-input').val(val);
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.letterSpacing = val;
            // Re-render if we find a way to support it, currently standard
            updateCustomText( $('#custom-text-input').val() );
        }
    });

    // Text Alignment
    // Use click on the container label to allow re-triggering the same alignment
    // (e.g. if user moved text manually and wants to snap back to center)
    $('.delivery-option:has(input[name="text-align"])').click(function(e) {
        // Prevent double-firing if clicking child elements triggers parent click
        // But we want the logic to run.
        
        const $input = $(this).find('input');
        const val = $input.val();
        
        // Ensure checked (visual and logical)
        $input.prop('checked', true);
        
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.alignment = val;
            
            // Handle Position Reset based on Limits
            if (activeModelConfig && activeModelConfig.alignmentConfig) {
                const conf = activeModelConfig.alignmentConfig;
                const axis = conf.axis || 'x';
                let newPos = 0;
                
                if (val === 'left') newPos = conf.min;
                else if (val === 'right') newPos = conf.max;
                else newPos = (conf.min + conf.max) / 2;
                
                activeModelConfig.text.position[axis] = newPos;
                
                // Update UI Input
                $(`#text-pos-${axis}`).val(newPos);
                
                // Update Mesh Position
                updateTextPosition(); 
            }
            
            // Update UI class
            $('.delivery-option:has(input[name="text-align"])').removeClass('active');
            $(this).addClass('active');
            
            updateCustomText( $('#custom-text-input').val() );
        }
    });

    // --- LOGO CONTROLS LISTENERS ---
    
    $('#logo-file-input').change(handleLogoUpload);

    $('#logo-size-slider, #logo-size-input').on('input', function() {
        const val = parseFloat($(this).val());
        $('#logo-size-slider, #logo-size-input').val(val);
        if (activeModelConfig && activeModelConfig.logo) {
            activeModelConfig.logo.scale = val;
            if (activeModelConfig.logo._lastSvg) {
                updateCustomLogo(activeModelConfig.logo._lastSvg);
            }
        }
    });

    // Logo Depth (SYNCED WITH TEXT)
    $('#logo-depth-slider, #logo-depth-input').on('input', function() {
        const val = parseFloat($(this).val());
        $('#logo-depth-slider, #logo-depth-input').val(val);
        
        // Sync to Text UI
        $('#text-depth-slider, #text-depth-input').val(val);

        if (activeModelConfig) {
             if (activeModelConfig.logo) {
                activeModelConfig.logo.depth = val;
                if (activeModelConfig.logo._lastSvg) {
                    updateCustomLogo(activeModelConfig.logo._lastSvg);
                }
            }
            if (activeModelConfig.text) {
                activeModelConfig.text.fontThickness = val;
                updateCustomText( $('#custom-text-input').val() );
            }
        }
    });

    // Logo Rotation
    $('#logo-rotation-x').on('input', function() {
        const val = (parseFloat($(this).val()) * Math.PI) / 180;
        $('#logo-rotation-x-value').text($(this).val() + '°');
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.rotation.x = val;
            logoMesh.rotation.x = val;
        }
    });
    $('#logo-rotation-y').on('input', function() {
        const val = (parseFloat($(this).val()) * Math.PI) / 180;
        $('#logo-rotation-y-value').text($(this).val() + '°');
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.rotation.y = val;
            logoMesh.rotation.y = val;
        }
    });
    $('#logo-rotation-z').on('input', function() {
        const val = (parseFloat($(this).val()) * Math.PI) / 180;
        $('#logo-rotation-z-value').text($(this).val() + '°');
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.rotation.z = val;
            logoMesh.rotation.z = val;
        }
    });

    // Logo Position
    $('#logo-pos-x').on('input', function() {
        const val = parseFloat($(this).val());
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.position.x = val;
            logoMesh.position.x = val;
        }
    });
    $('#logo-pos-y').on('input', function() {
        const val = parseFloat($(this).val());
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.position.y = val;
            logoMesh.position.y = val;
        }
    });
    $('#logo-pos-z').on('input', function() {
        const val = parseFloat($(this).val());
        if (activeModelConfig && activeModelConfig.logo && logoMesh) {
            activeModelConfig.logo.position.z = val;
            logoMesh.position.z = val;
        }
    });

    // Logo Color Listener
    $(document).on('click', '.logo-color-option', function() {
        $('.logo-color-option').removeClass('selected');
        $(this).addClass('selected');
        const hexColor = $(this).data('hex');
        if (logoMesh) {
            logoMesh.children.forEach(child => {
                if(child.material) child.material.color.set(hexColor);
            });
        }
        if (activeModelConfig && activeModelConfig.logo) {
            activeModelConfig.logo.color = hexColor;
        }
    });

    // Text Color change trigger (Updated to ONLY color text, Logo has its own now)
    $('#custom-text-color').on('input', function() {
        const color = $(this).val();
        if (textMesh && textMesh.material) textMesh.material.color.set(color);
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.color = color;
        }
    });

    // 4. Upload Button
    $('#upload-btn').click(() => $('#real-file-input').click());
    $('#real-file-input').change(handleFileUpload);

    // 5. Drag and Drop
    setupDragDrop();

    // 6. Mode Switcher & Tabs
    $('.tab-btn').click(function() {
        $('.tab-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode'); 
        
        // --- UPDATED VISIBILITY LOGIC ---
        // Basic Mode: Show only basic panel, hide advanced panel. Show only 'basic' items.
        // Pro Mode: Show basic panel AND advanced panel. Show 'basic' AND 'pro' items.

        if (mode === 'basic') {
            $('#panel-basic').fadeIn(200);
            $('#panel-advanced').hide();
        } else if (mode === 'advanced') {
            $('#panel-basic').show(); // Keep basic visible
            $('#panel-advanced').fadeIn(200);
        }

        // Re-run visibility check for individual controls
        updateControlsVisibility(mode);
    });

    // 7. Color Selection
    $('.color-option').click(function() { 
        $('.color-option').removeClass('selected'); 
        $(this).addClass('selected');
        const hexColor = $(this).data('hex'); 
        const colorName = $(this).data('color');
        $('#selected-color-name').text(colorName);

        if (mesh && mesh.material) {
            mesh.material.color.set(hexColor);
        }
    });

    // 8. Price Sync
    $('#material-select, #infill-select, #quantity-input').on('input change', function() {
        calculatePrice();
        syncBasicToPro();
    });

    $('#pro-infill, #pro-layer-height').on('input change', function() {
        syncProToBasic();
        calculatePrice();
    });
    
    // 9. Cart Actions
    $('#add-to-cart').off('click').on('click', addToCart);

    $(document).on('click', '.remove-btn', function() {
        const index = $(this).data('index');
        const itemToRemove = cart[index];

        const user = auth.currentUser;
        
        if (itemToRemove && itemToRemove.firebaseId && user) {
            const dbPath = `users/${user.uid}/saved_models/${itemToRemove.firebaseId}`;
            
            // Delete from Firebase
            remove(ref(db, dbPath)).catch(error => {
                console.error("Firebase deletion failed:", error);
            });
        }

        // Remove from local cart
        cart.splice(index, 1);
        saveCart();
        renderCart();
    });

    // Reset Custom Parameters Button - Using Event Delegation (Both buttons)
    $(document).on('click', '#reset-custom-params, #btn-reset-basic', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log("=== RESET BUTTON CLICKED ===");
        
        if (!originalModelConfig || !originalModelConfig.text) {
            console.warn("❌ No original model config found");
            console.log("originalModelConfig:", originalModelConfig);
            return;
        }

        console.log("✓ Original config found");
        console.log("originalModelConfig:", originalModelConfig);

        // Get ORIGINAL initial values (not the modified activeModelConfig)
        const initialPos = originalModelConfig.text.position;
        const initialRot = originalModelConfig.text.rotation;
        
        // New params reset
        const initialSize = originalModelConfig.text.fontSize || 10;
        const initialDepth = originalModelConfig.text.fontThickness || 4;
        const initialSpacing = originalModelConfig.text.letterSpacing || 0;
        const initialAlign = originalModelConfig.text.alignment || "center";

        console.log("Original Position:", initialPos);
        console.log("Original Rotation (radians):", initialRot);

        // Update rotation UI (convert radians to degrees)
        const rotXDeg = (initialRot.x || 0) * (180 / Math.PI);
        const rotYDeg = (initialRot.y || 0) * (180 / Math.PI);
        const rotZDeg = (initialRot.z || 0) * (180 / Math.PI);

        console.log("Converted to degrees - X:", rotXDeg, "Y:", rotYDeg, "Z:", rotZDeg);

        // Step 1: Update 3D mesh position and rotation FIRST
        console.log("Step 1: Updating 3D mesh...");
        if (textMesh) {
            console.log("textMesh exists, updating position and rotation");
            textMesh.position.set(initialPos.x || 0, initialPos.y || 0, initialPos.z || 10);
            textMesh.rotation.set(initialRot.x || 0, initialRot.y || 0, initialRot.z || 0);
            console.log("✓ 3D mesh updated");
            console.log("textMesh position:", textMesh.position);
            console.log("textMesh rotation:", textMesh.rotation);
        } else {
            console.warn("⚠️ textMesh is null or undefined");
        }

        // Step 2: Update BOTH configs to original values
        console.log("Step 2: Updating configs...");
        activeModelConfig.text.rotation = {
            x: initialRot.x || 0,
            y: initialRot.y || 0,
            z: initialRot.z || 0
        };
        activeModelConfig.text.position = {
            x: initialPos.x || 0,
            y: initialPos.y || 0,
            z: initialPos.z || 10
        };
        
        // Reset New Params in Config
        activeModelConfig.text.fontSize = initialSize;
        activeModelConfig.text.fontThickness = initialDepth;
        activeModelConfig.text.letterSpacing = initialSpacing;
        activeModelConfig.text.alignment = initialAlign;

        console.log("✓ Configs updated");
        console.log("Updated position:", activeModelConfig.text.position);
        console.log("Updated rotation:", activeModelConfig.text.rotation);

        // Step 3: Temporarily remove listeners
        console.log("Step 3: Removing event listeners...");
        $('#text-rotation-x').off('input');
        $('#text-rotation-y').off('input');
        $('#text-rotation-z').off('input');
        $('#text-pos-x').off('input');
        $('#text-pos-y').off('input');
        $('#text-pos-z').off('input');
        console.log("✓ Event listeners removed");

        // Step 4: Update UI values
        console.log("Step 4: Updating UI values...");
        
        $('#text-rotation-x').val(rotXDeg.toFixed(1));
        $('#text-rotation-x-value').text(rotXDeg.toFixed(0) + '°');
        console.log("✓ Rotation X updated:", rotXDeg.toFixed(1));

        $('#text-rotation-y').val(rotYDeg.toFixed(1));
        $('#text-rotation-y-value').text(rotYDeg.toFixed(0) + '°');
        console.log("✓ Rotation Y updated:", rotYDeg.toFixed(1));

        $('#text-rotation-z').val(rotZDeg.toFixed(1));
        $('#text-rotation-z-value').text(rotZDeg.toFixed(0) + '°');
        console.log("✓ Rotation Z updated:", rotZDeg.toFixed(1));

        $('#text-pos-x').val((initialPos.x || 0).toFixed(2));
        console.log("✓ Position X updated:", (initialPos.x || 0).toFixed(2));
        
        $('#text-pos-y').val((initialPos.y || 0).toFixed(2));
        console.log("✓ Position Y updated:", (initialPos.y || 0).toFixed(2));
        
        $('#text-pos-z').val((initialPos.z || 10).toFixed(2));
        console.log("✓ Position Z updated:", (initialPos.z || 10).toFixed(2));
        
        // Reset New UI Controls
        $('#text-size-slider, #text-size-input').val(initialSize);
        $('#text-depth-slider, #text-depth-input').val(initialDepth);
        $('#letter-spacing-slider, #letter-spacing-input').val(initialSpacing);
        $(`input[name="text-align"][value="${initialAlign}"]`).prop('checked', true).trigger('change');

        // Step 5: Re-attach listeners
        console.log("Step 5: Re-attaching event listeners...");
        $('#text-rotation-x').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-x-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-rotation-y').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-y-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-rotation-z').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-z-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-pos-x').on('input', function() {
            updateTextPosition();
        });

        $('#text-pos-y').on('input', function() {
            updateTextPosition();
        });

        $('#text-pos-z').on('input', function() {
            updateTextPosition();
        });
        
        // Re-render text to reflect changes
        updateCustomText( $('#custom-text-input').val() );

        console.log("✓ Event listeners re-attached");
        console.log("=== RESET COMPLETE ===");
    });

    // Delivery Priority Click Handler (to fix focus/active state issue)
    $('.delivery-list .delivery-option').click(function() {
        // 1. Visually update active state
        $('.delivery-list .delivery-option').removeClass('active');
        $(this).addClass('active');

        // 2. Ensure radio input is checked
        const $input = $(this).find('input[type="radio"]');
        $input.prop('checked', true);

        // 3. Trigger calculation (since we manually changed it)
        calculatePrice();
        syncBasicToPro();
    });

    // --- MODAL LOGIC ---

    // Open Modal when Model Card clicked
    $(document).on('click', '.model-card', function() {
        const id = $(this).data('id');
        const model = allFirebaseModels.find(m => m.id === id);
        
        if(model) {
            currentModalImages = model.images || ["./content/product2.jpeg"];
            currentImageIndex = 0;
            updateModalImage();
            
            $('#modal-title').text(model.name);
            $('#modal-desc').text(model.desc);
            $('#modal-price').text('₺' + model.price.toFixed(2));
            
            currentModalStl = model.stl;
            currentModalName = model.name;
            currentModalId = model.id;

            // Show/hide carousel controls based on image count
            if (currentModalImages.length > 1) {
                $('.modal-carousel-controls').show();
            } else {
                $('.modal-carousel-controls').hide();
            }

            $('#model-modal').addClass('open');
        }
    });

    // Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        if (e.target === this) {
            $('#model-modal').removeClass('open');
        }
    });

    // Image carousel navigation
    $('#modal-prev-btn').click(function() {
        currentImageIndex = (currentImageIndex - 1 + currentModalImages.length) % currentModalImages.length;
        updateModalImage();
    });

    $('#modal-next-btn').click(function() {
        currentImageIndex = (currentImageIndex + 1) % currentModalImages.length;
        updateModalImage();
    });

	// "Show in Studio" Button in Modal
	$('#modal-show-studio-btn').click(function() {
		$('#model-modal').removeClass('open');
		
		let model = allFirebaseModels.find(m => m.id == currentModalId);

		if (!model) {
			 model = {
				name: currentModalName,
				stl: currentModalStl,
				isCustomizable: false,
				customConfig: null
			 };
		}
		openInStudio(model);
	});

    // --- CHECKOUT FLOW ---
    $('#btn-checkout-start').click(function() {
        if(cart.length === 0) {
            showToast("Sepetiniz boş.", "error");
            return;
        }

        const user = auth.currentUser;
        // If user is real (not anonymous), go straight to payment
        if (user && !user.isAnonymous) {
            window.location.href = "./payment";
        } else {
            // Guest or not logged in -> Ask
            $('#auth-decision-modal').addClass('open');
        }
    });

    $('#modal-btn-login').click(function() {
        $('#auth-decision-modal').removeClass('open');
        switchPage('#login-page');
    });

    $('#modal-btn-guest').click(function() {
        // Proceed as guest
        window.location.href = "./payment";
    });

    // --- CLOSE MODALS (Universal) ---
    $(document).on('click', '.modal-close, .modal-overlay', function(e) {
        if (e.target === this) {
            $(this).removeClass('open');
            // If it's the auth modal specifically, we can also use its ID
            $('#auth-decision-modal').removeClass('open');
        }
    });
});

// --- HELPER FUNCTIONS ---

function showToast(message, type = "info") {
    // --- Error Translation Logic ---
    let displayMessage = message;

    if (type === "error") {
        const errorMap = {
            "auth/email-already-in-use": "Bu e-posta adresi zaten kullanımda.",
            "auth/invalid-email": "Geçersiz e-posta adresi.",
            "auth/user-not-found": "Kullanıcı bulunamadı.",
            "auth/wrong-password": "Şifre hatalı.",
            "auth/weak-password": "Şifre çok zayıf (en az 6 karakter olmalı).",
            "auth/network-request-failed": "Ağ hatası. Lütfen internet bağlantınızı kontrol edin.",
            "auth/too-many-requests": "Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.",
            "auth/operation-not-allowed": "Bu işlem şu anda yapılamıyor.",
            "auth/admin-restricted-operation": "Yönetici izni gereklidir (Anonim giriş kapalı olabilir).",
            "auth/missing-email": "Lütfen e-posta adresinizi girin."
        };

        // Check if the message contains any of the error codes
        for (const [code, friendlyMsg] of Object.entries(errorMap)) {
            if (message.includes(code)) {
                displayMessage = "Hata: " + friendlyMsg;
                break;
            }
        }
        
        // Cleanup standard Firebase prefixes if no specific map found but it's still a Firebase error
        if (displayMessage.includes("Firebase: Error")) {
            displayMessage = displayMessage.replace("Firebase: Error", "Hata").replace(/\(auth\/.*\)\.?/, "").trim();
        }
    }

    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-circle-info');
    
    const toastHtml = `
        <div id="toast-${id}" class="toast ${type}">
            <i class="fa-solid ${icon} toast-icon"></i>
            <span class="toast-message">${displayMessage}</span>
        </div>
    `;
    
    const $toast = $(toastHtml);
    $container.append($toast);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        $toast.addClass('hiding');
        setTimeout(() => $toast.remove(), 300);
    }, 4000);
}

async function migrateGuestData(guestUid, newUid) {
    if (!guestUid || !newUid || guestUid === newUid) return;

    const guestRef = ref(db, `users/${guestUid}/saved_models`);
    const newRef = ref(db, `users/${newUid}/saved_models`);

    try {
        const snapshot = await get(guestRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            const updates = {};
            
            // Push each item to the new user's list
            Object.values(data).forEach(item => {
                const newItemRef = push(newRef);
                updates[newItemRef.key] = item;
            });

            // Perform the update on the new user node
            await set(ref(db, `users/${newUid}/saved_models`), updates); // Use merge logic if needed, but here simple set/update works for new accounts. 
            // Better approach for merging:
            // Since set() overwrites, and we might be signing into an EXISTING account with EXISTING data, we should iterate and push.
            // The logic above constructed a new object. Let's fix to use push correctly or update.
            // Actually, simply looping and setting is safer.
            
            const promises = Object.values(data).map(item => {
                 return push(newRef, item);
            });
            await Promise.all(promises);

            // Delete old guest data
            await remove(ref(db, `users/${guestUid}`));
            console.log("Migration successful");
        }
    } catch (error) {
        console.error("Migration failed:", error);
    }
}

function syncUIWithConfig(config) {
    if (!config) return;
    const txtConfig = config.text || {};

    // 1. Text Content
    const initialText = txtConfig.initialContent || ""; // Empty default for uploads
    $('#custom-text-input').val(initialText);
    
    // 2. Font Selection
    const fontUrl = txtConfig.fontUrl || 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json';
    let fontId = 'helvetiker_bold';
    if(fontUrl.includes('helvetiker_regular')) fontId = 'helvetiker_regular';
    else if(fontUrl.includes('optimer_bold')) fontId = 'optimer_bold';
    else if(fontUrl.includes('optimer_regular')) fontId = 'optimer_regular';
    else if(fontUrl.includes('droid_sans_bold')) fontId = 'droid_sans_bold';
    else if(fontUrl.includes('droid_sans_regular')) fontId = 'droid_sans_regular';
    $('#text-font-select').val(fontId);
    
    // 3. Text Size
    const fSize = txtConfig.fontSize || 10;
    $('#text-size-slider, #text-size-input').val(fSize);

    // 4. Text Depth
    const fDepth = txtConfig.fontThickness || 4;
    $('#text-depth-slider, #text-depth-input').val(fDepth);

    // 5. Letter Spacing
    const fSpace = txtConfig.letterSpacing || 0;
    $('#letter-spacing-slider, #letter-spacing-input').val(fSpace);

    // 6. Alignment
    const fAlign = txtConfig.alignment || "center";
    $(`input[name="text-align"][value="${fAlign}"]`).prop('checked', true);
    $('.delivery-option:has(input[name="text-align"])').removeClass('active');
    $(`.delivery-option:has(input[name="text-align"][value="${fAlign}"])`).addClass('active');

    // 7. Text Color
    const fColor = txtConfig.color || "#FFFFFF";
    $('.text-color-option').removeClass('selected');
    let $colorOption = $(`.text-color-option[data-hex="${fColor}"]`);
    if(!$colorOption.length) $colorOption = $(`.text-color-option[data-hex="${fColor.toUpperCase()}"]`);
    if($colorOption.length) $colorOption.addClass('selected');
    else $(`.text-color-option[data-hex="#FFFFFF"]`).addClass('selected');
    
    // 8. Rotation
    const rotation = txtConfig.rotation || { x: 0, y: 0, z: 0 };
    const rotXDeg = (rotation.x || 0) * (180 / Math.PI);
    const rotYDeg = (rotation.y || 0) * (180 / Math.PI);
    const rotZDeg = (rotation.z || 0) * (180 / Math.PI);
    
    $('#text-rotation-x').val(rotXDeg.toFixed(1));
    $('#text-rotation-x-value').text(rotXDeg.toFixed(0) + '°');
    
    $('#text-rotation-y').val(rotYDeg.toFixed(1));
    $('#text-rotation-y-value').text(rotYDeg.toFixed(0) + '°');
    
    $('#text-rotation-z').val(rotZDeg.toFixed(1));
    $('#text-rotation-z-value').text(rotZDeg.toFixed(0) + '°');
    
    // 9. Position
    const position = txtConfig.position || { x: 0, y: 0, z: 10 };
    $('#text-pos-x').val(position.x || 0);
    $('#text-pos-y').val(position.y || 0);
    $('#text-pos-z').val(position.z || 10);

    // 10. Logo UI
    const logoConfig = config.logo || {};
    $('#logo-size-slider, #logo-size-input').val(logoConfig.scale || 1);
    $('#logo-depth-slider, #logo-depth-input').val(logoConfig.depth || 4);
    
    // Logo Color Sync
    const lColor = logoConfig.color || "#FFFFFF";
    $('.logo-color-option').removeClass('selected');
    let $lColorOption = $(`.logo-color-option[data-hex="${lColor}"]`);
    if(!$lColorOption.length) $lColorOption = $(`.logo-color-option[data-hex="${lColor.toUpperCase()}"]`);
    if($lColorOption.length) $lColorOption.addClass('selected');
    else $(`.logo-color-option[data-hex="#FFFFFF"]`).addClass('selected');

    const lr = logoConfig.rotation || { x: 0, y: 0, z: 0 };
    const lp = logoConfig.position || { x: 0, y: 0, z: 0 };
    
    $('#logo-rotation-x').val(((lr.x || 0) * 180 / Math.PI).toFixed(0)); 
    $('#logo-rotation-x-value').text(((lr.x || 0) * 180 / Math.PI).toFixed(0) + '°');
    $('#logo-rotation-y').val(((lr.y || 0) * 180 / Math.PI).toFixed(0));
    $('#logo-rotation-y-value').text(((lr.y || 0) * 180 / Math.PI).toFixed(0) + '°');
    $('#logo-rotation-z').val(((lr.z || 0) * 180 / Math.PI).toFixed(0));
    $('#logo-rotation-z-value').text(((lr.z || 0) * 180 / Math.PI).toFixed(0) + '°');
    
    $('#logo-pos-x').val(lp.x || 0);
    $('#logo-pos-y').val(lp.y || 0);
    $('#logo-pos-z').val(lp.z || 0);
}

function updateModalImage() {
    if (currentModalImages.length > 0) {
        $('#modal-img').attr('src', currentModalImages[currentImageIndex]);
        $('#modal-image-counter').text((currentImageIndex + 1) + ' / ' + currentModalImages.length);
    }
}

function renderHomeLibrary() {
    const $grid = $('#home-models-grid');
    $grid.empty();

    // Sort by sellCount descending and take top 3
    const topModels = [...allFirebaseModels]
        .sort((a, b) => (b.sellCount || 0) - (a.sellCount || 0))
        .slice(0, 3);

    topModels.forEach(model => {
        const firstImage = (model.images && model.images.length > 0) ? model.images[0] : (model.img || "./content/product2.jpeg");
        
        $grid.append(`
            <div class="model-card" data-id="${model.id}">
                <div class="card-image"><img src="${firstImage}" alt="${model.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${model.name}</div>
                    <div class="model-desc">${model.desc.substring(0, 60)}...</div>
                    <div class="card-meta">
                        <span class="price-tag">₺${model.price.toFixed(2)}</span>
                        <button class="btn-sm library-select-btn" 
                            data-id="${model.id}" 
                            data-name="${model.name}" 
                            data-stl="${model.stl}" 
                            data-custom="${model.isCustomizable || false}">
                            Özelleştir
                        </button>
                    </div>
                </div>
            </div>
        `);
    });
}

function renderModelsPage(modelsList) {
    // Safety check
    if (!modelsList) {
        modelsList = [];
    }

    const $grid = $('#models-grid-container');
    $grid.empty();
    
    if (modelsList.length === 0) {
        if (allFirebaseModels && allFirebaseModels.length > 0) {
             $grid.html('<p style="grid-column: 1/-1; text-align: center; color: #94A3B8;">Aramanızla eşleşen model bulunamadı.</p>');
        }
        return;
    }

    modelsList.forEach(model => {
        const firstImage = (model.images && model.images.length > 0) ? model.images[0] : model.img || "./content/product2.jpeg";
        
        $grid.append(`
            <div class="model-card" data-id="${model.id}">
                <div class="card-image"><img src="${firstImage}" alt="${model.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${model.name}</div>
                    <div class="model-desc">${model.desc.substring(0, 60)}...</div>
                    <div class="card-meta">
                        <span class="price-tag">₺${model.price.toFixed(2)}</span>
                        <button class="btn-sm library-select-btn" 
                            data-id="${model.id}" 
                            data-name="${model.name}" 
                            data-stl="${model.stl}" 
                            data-custom="${model.isCustomizable || false}">
                            Özelleştir
                        </button>
                    </div>
                </div>
            </div>
        `);
    });
}

function loadUserOrders(userId) {
    const ordersRef = ref(db, 'orders/' + userId);
    onValue(ordersRef, (snapshot) => {
        const data = snapshot.val();
        const $list = $('#orders-list');
        $list.empty();
        
        if (data) {
            Object.values(data).forEach((order) => {
                $list.append(`
                    <div class="cart-item">
                        <div class="info">
                            <div style="font-weight:600">Sipariş #${order.id}</div>
                            <div style="font-size:0.8rem">${order.date}</div>
                        </div>
                        <div style="font-weight:500">₺${order.total}</div>
                        <div style="color: green; font-size: 0.85rem; font-weight: 600;">${order.status}</div>
                    </div>
                `);
            });
        } else {
            $list.html('<p>Geçmiş sipariş bulunamadı.</p>');
        }
    });
}

function checkParamVisibility(paramName, currentMode) {
    const configVal = activeModelConfig?.customizableParams?.[paramName] || 0;
    
    // Case 1: Param is 0 ('none') -> Never visible
    if (configVal === 0) return false;

    // Case 2: Param is 1 ('basic') -> Always visible (Basic implies Pro)
    if (configVal === 1) return true; 

    // Case 3: Param is 2 ('pro') -> Only visible in 'advanced' (Pro) mode
    if (configVal === 2) return currentMode === 'advanced';

    return false; // Fallback
}

function updateControlsVisibility(mode) {
    if (!activeModelConfig || !activeModelConfig.customizableParams) return;

    // --- MASTER SWITCHES ---
    // textContent acts as Master Switch for ALL text controls
    const masterTextVisible = checkParamVisibility('textContent', mode);
    
    // logo acts as Master Switch for ALL logo controls
    const masterLogoVisible = checkParamVisibility('logo', mode);

    // 1. Text Content (Input Box)
    $('#custom-text-input').closest('.form-group, #custom-text-group > label + textarea, #custom-text-group > textarea').prev('label').toggle(masterTextVisible);
    $('#custom-text-input').toggle(masterTextVisible);

    // 2. Text Font
    const showFont = masterTextVisible && checkParamVisibility('textFont', mode);
    $('#text-font-select').prev('label').toggle(showFont);
    $('#text-font-select').toggle(showFont);

    // 3. Text Size
    const showSize = masterTextVisible && checkParamVisibility('textSize', mode);
    $('#text-size-slider').closest('.form-group').prev('label').toggle(showSize);
    $('#text-size-slider').closest('.form-group').toggle(showSize);

    // 4. Text Depth
    const showDepth = masterTextVisible && checkParamVisibility('textDepth', mode);
    $('#text-depth-slider').closest('.form-group').prev('label').toggle(showDepth);
    $('#text-depth-slider').closest('.form-group').toggle(showDepth);

    // 5. Letter Spacing
    const showSpacing = masterTextVisible && checkParamVisibility('letterSpacing', mode);
    $('#letter-spacing-slider').closest('.form-group').prev('label').toggle(showSpacing);
    $('#letter-spacing-slider').closest('.form-group').toggle(showSpacing);

    // 6. Text Alignment
    const showAlign = masterTextVisible && checkParamVisibility('textAlignment', mode);
    $('input[name="text-align"]').first().closest('.form-group').prev('label').toggle(showAlign);
    $('input[name="text-align"]').first().closest('.form-group').toggle(showAlign);

    // 7. Text Color
    const showTextColor = masterTextVisible && checkParamVisibility('textColor', mode);
    $('#custom-text-group .color-grid').first().prev('label').toggle(showTextColor);
    $('#custom-text-group .color-grid').first().toggle(showTextColor);
    
    // 8. Text Rotations (Group)
    const showRotX = masterTextVisible && checkParamVisibility('textRotationX', mode);
    const showRotY = masterTextVisible && checkParamVisibility('textRotationY', mode);
    const showRotZ = masterTextVisible && checkParamVisibility('textRotationZ', mode);
    const anyRotVisible = showRotX || showRotY || showRotZ;

    $('#text-rotation-x').closest('.form-group').toggle(showRotX);
    $('#text-rotation-y').closest('.form-group').toggle(showRotY);
    $('#text-rotation-z').closest('.form-group').toggle(showRotZ);
    // Toggle the Rotation Container (The white box)
    $('#text-rotation-x').closest('.form-group').parent().toggle(anyRotVisible);
    
    // 9. Text Positions (Group)
    const showPosX = masterTextVisible && checkParamVisibility('textPositionX', mode);
    const showPosY = masterTextVisible && checkParamVisibility('textPositionY', mode);
    const showPosZ = masterTextVisible && checkParamVisibility('textPositionZ', mode);
    const anyPosVisible = showPosX || showPosY || showPosZ;

    $('#text-pos-x').closest('.form-group').toggle(showPosX);
    $('#text-pos-y').closest('.form-group').toggle(showPosY);
    $('#text-pos-z').closest('.form-group').toggle(showPosZ);
    // Toggle the Position Container (The white box)
    $('#text-pos-x').closest('.form-group').parent().toggle(anyPosVisible);


    // 10. Other Params (Model Color, Material, etc.) - Independent of Text/Logo
    // Model Color (The one in the main panel, distinct from text color)
    // Note: The selector needs to be specific to avoid hiding text color grid if selectors overlap
    const showModelColor = checkParamVisibility('modelColor', mode);
    $('#panel-basic > .form-group:has(.color-grid)').toggle(showModelColor);

    // Material
    const showMaterial = checkParamVisibility('material', mode);
    $('#material-select').closest('.form-group').toggle(showMaterial);

    // Infill
    const showInfill = checkParamVisibility('infill', mode);
    $('#infill-select').closest('.form-group').toggle(showInfill);

    // Quantity
    const showQuantity = checkParamVisibility('quantity', mode);
    $('#quantity-input').closest('.form-group').toggle(showQuantity);

    // 11. Delivery
    const showDelivery = checkParamVisibility('delivery', mode);
    $('input[name="delivery"]').first().closest('.form-group').toggle(showDelivery);


    // 12. Logo Section
    $('#custom-logo-container').toggle(masterLogoVisible);

    if (masterLogoVisible) {
        // Logo Size
        const showLogoSize = checkParamVisibility('logoSize', mode);
        $('#logo-size-slider').closest('.form-group').prev('label').toggle(showLogoSize);
        $('#logo-size-slider').closest('.form-group').toggle(showLogoSize);

        // Logo Depth
        const showLogoDepth = checkParamVisibility('logoDepth', mode);
        $('#logo-depth-slider').closest('.form-group').prev('label').toggle(showLogoDepth);
        $('#logo-depth-slider').closest('.form-group').toggle(showLogoDepth);

        // Logo Color
        const showLogoColor = checkParamVisibility('logoColor', mode);
        $('#custom-logo-container .color-grid').prev('label').toggle(showLogoColor);
        $('#custom-logo-container .color-grid').toggle(showLogoColor);

        // Logo Rotations
        const showLogoRotX = checkParamVisibility('logoRotationX', mode);
        const showLogoRotY = checkParamVisibility('logoRotationY', mode);
        const showLogoRotZ = checkParamVisibility('logoRotationZ', mode);
        const anyLogoRotVisible = showLogoRotX || showLogoRotY || showLogoRotZ;

        $('#logo-rotation-x').closest('.form-group').toggle(showLogoRotX);
        $('#logo-rotation-y').closest('.form-group').toggle(showLogoRotY);
        $('#logo-rotation-z').closest('.form-group').toggle(showLogoRotZ);
        $('#logo-rotation-x').closest('.form-group').parent().toggle(anyLogoRotVisible);

        // Logo Positions
        const showLogoPosX = checkParamVisibility('logoPositionX', mode);
        const showLogoPosY = checkParamVisibility('logoPositionY', mode);
        const showLogoPosZ = checkParamVisibility('logoPositionZ', mode);
        const anyLogoPosVisible = showLogoPosX || showLogoPosY || showLogoPosZ;

        $('#logo-pos-x').closest('.form-group').toggle(showLogoPosX);
        $('#logo-pos-y').closest('.form-group').toggle(showLogoPosY);
        $('#logo-pos-z').closest('.form-group').toggle(showLogoPosZ);
        $('#logo-pos-x').closest('.form-group').parent().toggle(anyLogoPosVisible);
    }

    // 13. Parent Group Visibility
    // Hide the entire custom-text-group if neither Text nor Logo is visible
    if (!masterTextVisible && !masterLogoVisible) {
        $('#custom-text-group').hide();
    } else {
        $('#custom-text-group').fadeIn();
    }
}

function openInStudio(model) {
    // --- CLEAR INPUT ---
    $('#real-file-input').val('');
    $('#logo-file-input').val(''); // Clear logo input

    // Force switch to 'basic' tab initially
    $('.tab-btn[data-mode="basic"]').click(); 

    switchPage('#upload-page');
    $('#file-name-display').text(model.name);
    
	currentLibraryModel = model; // Store the full model data to reference later
    activeModelConfig = model.customConfig || null;
    
    // NEW: Deep copy the original config for reset functionality
    originalModelConfig = JSON.parse(JSON.stringify(model.customConfig || null));

    // Clear Logo Mesh
    if (logoMesh) {
        if (mesh) mesh.remove(logoMesh);
        logoMesh = null;
    }
    
    // Reset Logo Config Defaults in UI if present
    if (activeModelConfig && activeModelConfig.logo) {
        // LOAD DEFAULT LOGO
        if (activeModelConfig.customizableParams && activeModelConfig.customizableParams.logo > 0) {
            if (activeModelConfig.logo && activeModelConfig.logo.content) {
                updateCustomLogo(activeModelConfig.logo.content);
            } else {
                updateCustomLogo(DEFAULT_LOGO_SVG);
            }
        } else {
             activeModelConfig.logo._lastSvg = null; 
        }
        
        $('#logo-size-slider, #logo-size-input').val(activeModelConfig.logo.scale || 1);
        $('#logo-depth-slider, #logo-depth-input').val(activeModelConfig.logo.depth || 4);
        
        const r = activeModelConfig.logo.rotation || { x: 0, y: 0, z: 0 };
        const p = activeModelConfig.logo.position || { x: 0, y: 0, z: 0 };
        
        $('#logo-rotation-x').val((r.x * 180 / Math.PI) || 0); $('#logo-rotation-x-value').text(((r.x * 180 / Math.PI) || 0).toFixed(0) + '°');
        $('#logo-rotation-y').val((r.y * 180 / Math.PI) || 0); $('#logo-rotation-y-value').text(((r.y * 180 / Math.PI) || 0).toFixed(0) + '°');
        $('#logo-rotation-z').val((r.z * 180 / Math.PI) || 0); $('#logo-rotation-z-value').text(((r.z * 180 / Math.PI) || 0).toFixed(0) + '°');
        
        $('#logo-pos-x').val(p.x || 0);
        $('#logo-pos-y').val(p.y || 0);
        $('#logo-pos-z').val(p.z || 0);
    }

    if (model.isCustomizable) {
        $('#custom-text-group').fadeIn(); 
        
        // Use helper to sync UI
        syncUIWithConfig(activeModelConfig);
        
        // Initial visibility update
        updateControlsVisibility('basic');
        
    } else {
        $('#custom-text-group').hide();
    }

    loadLibrarySTL(model.stl);
}

function setupDragDrop() {
    // 1. Viewer Drop Zone
    const dropZone = document.querySelector('.viewer-container');
    const overlay = document.getElementById('drop-zone-overlay');
    let dragCounter = 0;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    dropZone.addEventListener('dragenter', () => {
        dragCounter++;
        overlay.style.display = 'flex';
    });

    dropZone.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter === 0) overlay.style.display = 'none';
    });

    dropZone.addEventListener('drop', (e) => {
        dragCounter = 0;
        overlay.style.display = 'none';
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
    });

    // 2. Logo Upload Box Drop Zone
    const logoDropZone = document.getElementById('logo-upload-box');
    if (logoDropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            logoDropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        });

        logoDropZone.addEventListener('dragenter', () => {
            logoDropZone.style.borderColor = '#3b82f6';
            logoDropZone.style.backgroundColor = '#eff6ff';
        });

        logoDropZone.addEventListener('dragleave', () => {
            logoDropZone.style.borderColor = '#bfdbfe';
            logoDropZone.style.backgroundColor = 'white';
        });

        logoDropZone.addEventListener('drop', (e) => {
            logoDropZone.style.borderColor = '#bfdbfe';
            logoDropZone.style.backgroundColor = 'white';
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFile(files[0]);
        });
    }
}

function syncBasicToPro() {
    const basicInfill = $('#infill-select').val();
    $('#pro-infill').val(basicInfill);
}

function syncProToBasic() {
    const proInfill = $('#pro-infill').val();
    $(`#infill-select option[value="${proInfill}"]`).prop('selected', true);
}

function switchPage(targetId, pushState = true) {
    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    
    if (targetId === '#login-page' || targetId === '#dashboard-page') {
        $('#nav-user-container').addClass('active');
    }

    $('.page').removeClass('active');
    $(targetId).addClass('active');
    
    if (targetId === '#upload-page') {
        setTimeout(updateDimensions, 100);
    }
    window.scrollTo(0, 0);

    if (pushState) {
        // Map IDs to URL params
        const map = {
            '#home-page': 'home',
            '#models-page': 'models',
            '#upload-page': 'studio',
            '#checkout-page': 'checkout',
            '#login-page': 'login',
            '#dashboard-page': 'dashboard'
        };
        const param = map[targetId] || 'home';
        const newUrl = window.location.pathname + '?' + param;
        window.history.pushState({ page: targetId }, "", newUrl);
    }
}

// --- THREE.JS LOGIC ---
function init3D() {
    const container = document.getElementById('3d-viewer');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF8F9FB); 
    
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 150, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(200, 200, 200); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false; 

    createBed();
    
    // Setup drag listener (Moved from updateCustomText to support Logo dragging even if Text is hidden)
    if (!textDragListenerSetup) {
        setupTextDragListener();
        textDragListenerSetup = true;
    }

    animate();
    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(container);
}

function createBed() {
    const geometry = new THREE.PlaneGeometry(BUILD_VOLUME_X, BUILD_VOLUME_Y);
    
    const material = new THREE.MeshPhongMaterial({ 
        color: 0x999999, 
        side: THREE.FrontSide, 
        shininess: 10 
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

    // Grid remains visible
    const gridHelper = new THREE.GridHelper(BUILD_VOLUME_X, 12, 0x444444, 0x555555);
    gridHelper.position.y = 0.1; 
    scene.add(gridHelper);
}

function updateDimensions() {
    const container = document.getElementById('3d-viewer');
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if(width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

function animate() {
    requestAnimationFrame(animate);
    if(controls) controls.update();
    renderer.render(scene, camera);
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    handleFile(file);
}

function handleFile(file) {
    if (!file) return;
    const fileName = file.name.toLowerCase();

    // 1. Handle SVG (Logo)
    if (fileName.endsWith('.svg')) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const svgContent = event.target.result;
            // Check if we have an active model to apply this to
            if (!mesh) {
                showToast("Lütfen önce bir 3D model yükleyin veya seçin.", "error");
                return;
            }
            updateCustomLogo(svgContent);
            // Ensure logo controls are visible
            if (activeModelConfig) {
                 if (activeModelConfig.customizableParams) activeModelConfig.customizableParams.logo = 1;
                 $('#custom-logo-container').show();
                 updateControlsVisibility('basic'); // Refresh visibility
            }
        };
        reader.readAsText(file);
        return;
    }

    // 2. Handle 3D Model (STL/3MF)
    if (!fileName.endsWith('.stl') && !fileName.endsWith('.3mf')) {
        showToast("Sadece .STL, .3MF ve .SVG dosyaları desteklenmektedir.", "error");
        return;
    }
    
    // Clear library model reference
    currentLibraryModel = null; 
    
    // Assign default config for user uploads
    activeModelConfig = JSON.parse(JSON.stringify(USER_UPLOAD_CONFIG));
    originalModelConfig = JSON.parse(JSON.stringify(USER_UPLOAD_CONFIG));

    // Show text group (since USER_UPLOAD_CONFIG has params enabled)
    $('#custom-text-group').fadeIn();
    
    // Sync UI with Default Config
    syncUIWithConfig(activeModelConfig);
    
    // Update Visibility (defaults to basic mode)
    // Ensure basic mode is active visually
    $('.tab-btn[data-mode="basic"]').click(); 
    // updateControlsVisibility('basic'); // Click above handles this
    
    if (textMesh) {
         scene.remove(textMesh);
         textMesh = null;
    }

    $('#file-name-display').text(file.name);
    const reader = new FileReader();
    reader.onload = function(ev) { loadSTL(ev.target.result); };
    reader.readAsArrayBuffer(file);
}

function loadLibrarySTL(url) {
    fetch(url)
        .then(res => { if(!res.ok) throw new Error("Missing File"); return res.arrayBuffer(); })
        .then(data => loadSTL(data))
        .catch(err => {
             console.error(err);
             showToast("Dosya açılırken bir hata oluştu.", "error");
        });
}

function loadSTL(data) {
    const loader = new STLLoader();
    let geometry = null;
    let isFileValid = false;

    // 1. Read File
    try {
        if (data) {
            geometry = loader.parse(data);
            if (geometry && geometry.attributes.position && geometry.attributes.position.count > 0) {
                geometry.computeBoundingBox();
                if (isFinite(geometry.boundingBox.min.x)) isFileValid = true;
            }
        }
    } catch (e) { console.warn("Could not read data."); }

    // 2. File not found: Create virtual box
    if (!isFileValid) {
        console.log("File could not be loaded, using Virtual Box.");
        geometry = new THREE.BoxGeometry(20, 20, 20);
    }

    // 3. Center geometry
    geometry.center(); 
    
    // 4. SCALING
    if (!isFileValid && activeModelConfig && activeModelConfig.baseScale) {
        const s = activeModelConfig.baseScale;
        geometry.scale(s.x, s.y, s.z);
    }

    // 5. Material
    const initialColor = $('.color-option.selected').data('hex') || 0x333333;
    const material = new THREE.MeshPhongMaterial({ 
        color: initialColor, 
        specular: 0x111111, 
        shininess: 30 
    });

    // Scene cleanup
    if (mesh) scene.remove(mesh);
    scene.children.forEach(child => {
        if (child.type === "BoxHelper" || child.type === "AxesHelper") scene.remove(child);
    });
    if (typeof textMesh !== 'undefined' && textMesh) {
         scene.remove(textMesh);
         textMesh = null;
    }

    // 6. Create mesh
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    
    // Positioning
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);

    // Rest on floor
    if (activeModelConfig) {
        if (!isFileValid) {
            mesh.rotation.x = 0;
            mesh.position.y = size.y / 2;
        } else {
            mesh.rotation.x = -Math.PI / 2; 
            mesh.position.y = size.z / 2;
        }
    } else {
        mesh.rotation.x = -Math.PI / 2; 
        mesh.position.y = size.z / 2;
    }

    if (!isFinite(mesh.position.y)) mesh.position.y = 0;

    scene.add(mesh);

    // 7. Add text
    if (activeModelConfig) {
        try { updateCustomText(activeModelConfig.text.initialContent); } catch(e){}
        // Add Logo
        if (activeModelConfig.logo && (activeModelConfig.logo._lastSvg || activeModelConfig.logo.content)) {
             try { updateCustomLogo(activeModelConfig.logo._lastSvg || activeModelConfig.logo.content); } catch(e){}
        }
    }

    // 8. Panel Info
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    $('#dim-x').text(finalSize.x.toFixed(1));
    $('#dim-y').text(finalSize.y.toFixed(1));
    $('#dim-z').text(finalSize.z.toFixed(1));
    $('.dimensions-box').fadeIn();

    // 9. Auto-Focus camera
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    let fitDistance = Math.max(maxDim * 1.5, 60);

    camera.position.set(fitDistance, fitDistance, fitDistance);
    
    const center = new THREE.Vector3();
    finalBox.getCenter(center);
    camera.lookAt(center);
    
    if(controls) {
        controls.target.copy(center);
        controls.enabled = true;
        controls.update();
    }

    const vol = getVolume(geometry) / 1000;
    $('#model-vol').data('raw', (isNaN(vol) || vol <= 0) ? 10 : vol);
    
    calculatePrice();
    $('#add-to-cart').prop('disabled', false);
}

let textMesh = null;
let logoMesh = null;
let isDraggingText = false;
let isDraggingLogo = false; // New for Logo Dragging
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragPoint = new THREE.Vector3();
let textDragListenerSetup = false;

// ... (existing updateCustomText function) ...

function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== 'image/svg+xml') {
        alert("Lütfen geçerli bir SVG dosyası yükleyin.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const svgContent = event.target.result;
        updateCustomLogo(svgContent);
    };
    reader.readAsText(file);
}

function updateCustomLogo(svgContent) {
    if (!mesh || !activeModelConfig || !activeModelConfig.logo) return;

    // CHECK VISIBILITY PARAM
    const logoParam = activeModelConfig.customizableParams ? activeModelConfig.customizableParams.logo : 1;
    if (logoParam === 0) {
        if (logoMesh) {
            mesh.remove(logoMesh);
            if (logoMesh.geometry) logoMesh.geometry.dispose();
            logoMesh = null;
        }
        return;
    }

    // Remove existing logo mesh
    if (logoMesh) {
        mesh.remove(logoMesh);
        if (logoMesh.geometry) logoMesh.geometry.dispose();
        logoMesh = null;
    }

    // If just clearing or empty content
    if (!svgContent) return;

    const loader = new SVGLoader();
    const data = loader.parse(svgContent);
    const paths = data.paths;
    const group = new THREE.Group();

    const cfg = activeModelConfig.logo;
    const depth = cfg.depth || 2;
    const scale = cfg.scale || 1;

    // Material for Logo (using Logo-specific color)
    const selectedLogoDiv = $('.logo-color-option.selected');
    const currentColor = selectedLogoDiv.length > 0 ? selectedLogoDiv.data('hex') : (cfg.color || "#FFFFFF");
    const material = new THREE.MeshPhongMaterial({ color: currentColor });

    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const shapes = SVGLoader.createShapes(path);

        for (let j = 0; j < shapes.length; j++) {
            const shape = shapes[j];
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: depth,
                bevelEnabled: false
            });
            
            // Center the geometry roughly
            geometry.center();
            
            // Move it so the bottom face is at Z=0 (instead of Z=-depth/2)
            geometry.translate(0, 0, depth / 2);

            const meshPart = new THREE.Mesh(geometry, material);
            
            // SVG Y coordinates are inverted relative to Three.js
            meshPart.scale.y = -1;
            
            group.add(meshPart);
        }
    }

    // Scale the entire group
    // Note: SVGs can be huge or tiny. We might need normalization, 
    // but relying on user slider 'scale' is safer for flexibility.
    // However, SVG units are pixels usually. 
    // Let's normalize to a standard size (e.g., 20 units width) then apply scale.
    const bbox = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    const baseSize = 20; // Target base size
    const normFactor = baseSize / Math.max(size.x, size.y);
    
    // Apply scale ONLY to X and Y. Z should be controlled by 'depth' parameter directly.
    // We keep 'normFactor' on Z to keep units consistent, but NOT 'scale' (user size slider).
    group.scale.set(normFactor * scale, normFactor * scale, normFactor);

    logoMesh = group;

    // Position
    const pos = cfg.position || { x: 0, y: 0, z: 0 };
    logoMesh.position.set(pos.x, pos.y, pos.z);

    // Rotation
    const rot = cfg.rotation || { x: 0, y: 0, z: 0 };
    logoMesh.rotation.set(rot.x, rot.y, rot.z);

    mesh.add(logoMesh);
    
    // Store content for re-updates (e.g. scale change)
    // We attach it to the config temporarily or closure? 
    // Better: Store lastSVGContent globally or in a specialized state
    activeModelConfig.logo._lastSvg = svgContent;
}

// ... (rest of code) ...

function updateCustomText(message) {
    if (!mesh || !activeModelConfig) return;

    // CHECK VISIBILITY PARAM
    const textParam = activeModelConfig.customizableParams ? activeModelConfig.customizableParams.textContent : 1;
    if (textParam === 0) {
        if (textMesh) {
             mesh.remove(textMesh);
             if(textMesh.geometry) textMesh.geometry.dispose();
             textMesh = null;
        }
        return;
    }
    
    // If message is empty, delete
    if (message === "") {
        if (textMesh) mesh.remove(textMesh);
        textMesh = null;
        return;
    }

    const cfg = activeModelConfig.text;
    
    // Get color
    const selectedDiv = $('.text-color-option.selected');
    const currentColor = selectedDiv.length > 0 ? selectedDiv.data('hex') : (cfg.color || "#FFFFFF");

    const loader = new FontLoader();
    loader.load(cfg.fontUrl, function (font) {
        
        // Clean old text
        if (textMesh) {
            mesh.remove(textMesh);
            if(textMesh.geometry) textMesh.geometry.dispose();
        }

        const size = cfg.fontSize || 10;
        const height = cfg.fontThickness || 4;
        const spacing = cfg.letterSpacing || 0;
        const align = cfg.alignment || "center";
        const lineSpacing = 1.4; // 40% extra space between lines

        const lines = message.split('\n');
        const allGeometries = [];

        lines.forEach((lineText, lineIdx) => {
            if (lineText.trim() === "" && lines.length > 1) {
                // Skip completely empty lines but maybe handle them for spacing later
                return;
            }

            const charGeos = [];
            let xOffset = 0;

            for (let i = 0; i < lineText.length; i++) {
                const char = lineText[i];
                const charGeo = new TextGeometry(char, {
                    font: font,
                    size: size,
                    height: height,
                    curveSegments: 12,
                    bevelEnabled: false
                });

                charGeo.computeBoundingBox();
                const charWidth = charGeo.boundingBox.max.x - charGeo.boundingBox.min.x;
                
                charGeo.translate(xOffset, 0, 0);
                charGeos.push(charGeo);
                
                xOffset += charWidth + spacing;
            }

            if (charGeos.length > 0) {
                let lineGeo = mergeGeometries(charGeos);
                lineGeo.computeBoundingBox();
                const lineWidth = lineGeo.boundingBox.max.x - lineGeo.boundingBox.min.x;

                // Horizontal Alignment within the line relative to X=0
                let xShift = 0;
                if (align === "center") xShift = -lineWidth / 2;
                else if (align === "right") xShift = -lineWidth;
                // Left is 0

                // Vertical shift (Line 0 is top, Line 1 is below, etc.)
                const yShift = -lineIdx * size * lineSpacing;

                lineGeo.translate(xShift, yShift, 0);
                allGeometries.push(lineGeo);
            } else if (lineText === "") {
                // Optional: handle empty lines to preserve spacing if needed
            }
        });

        if (allGeometries.length === 0) return;

        let finalGeo = mergeGeometries(allGeometries);
        
        // Final vertical centering of the entire block
        finalGeo.computeBoundingBox();
        const bCenter = new THREE.Vector3();
        finalGeo.boundingBox.getCenter(bCenter);
        
        // Translate block so its center is at (0,0,0) locally
        // We only center Y and X if needed, but X alignment is already relative to 0.
        // If alignment is 'left', bCenter.x will be positive. We should only center Y.
        finalGeo.translate(0, -bCenter.y, 0);

        const textMat = new THREE.MeshPhongMaterial({ color: currentColor });
        textMesh = new THREE.Mesh(finalGeo, textMat);

        // Use position directly from config
        const pos = cfg.position || { x: 0, y: 0, z: 10 };
        textMesh.position.set(pos.x, pos.y, pos.z);

        // Apply rotation
        const rot = cfg.rotation || { x: 0, y: 0, z: 0 };
        textMesh.rotation.x = rot.x || 0;
        textMesh.rotation.y = rot.y || 0;
        textMesh.rotation.z = rot.z || 0;

        mesh.add(textMesh);

    });
}

function setupTextDragListener() {
    const canvas = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragStartPos = new THREE.Vector3();
    let dragStartScreenPos = new THREE.Vector2();

    canvas.addEventListener('mousedown', (event) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        
        // 1. Check Text
        let textIntersected = false;
        if (textMesh) {
            const intersects = raycaster.intersectObjects([textMesh]);
            if (intersects.length > 0) textIntersected = true;
        }

        // 2. Check Logo (Recursive for Group)
        let logoIntersected = false;
        if (logoMesh) {
            const intersects = raycaster.intersectObjects(logoMesh.children, true);
            if (intersects.length > 0) logoIntersected = true;
        }

        // Prioritize Text if both clicked (rare) or logic to pick closest
        if (textIntersected) {
            isDraggingText = true;
            dragStartPos.copy(textMesh.position);
            dragStartScreenPos.set(event.clientX - rect.left, event.clientY - rect.top);
            if (controls) controls.enabled = false;
            event.preventDefault();
        } else if (logoIntersected) {
            isDraggingLogo = true;
            dragStartPos.copy(logoMesh.position);
            dragStartScreenPos.set(event.clientX - rect.left, event.clientY - rect.top);
            if (controls) controls.enabled = false;
            event.preventDefault();
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (!isDraggingText && !isDraggingLogo) return;

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const isText = isDraggingText;
        const targetMesh = isText ? textMesh : logoMesh;
        
        if (!targetMesh) return;

        const paramPrefix = isText ? 'text' : 'logo';
        const getParamVal = (name) => activeModelConfig?.customizableParams?.[name] || 0;
        
        const canEditPosX = getParamVal(paramPrefix + 'PositionX') > 0;
        const canEditPosY = getParamVal(paramPrefix + 'PositionY') > 0;
        const canEditPosZ = getParamVal(paramPrefix + 'PositionZ') > 0;

        const currentScreenPos = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
        const screenDelta = currentScreenPos.clone().sub(dragStartScreenPos);

        // XY Movement (Camera Plane)
        let worldDeltaXY = new THREE.Vector3(0, 0, 0);
        if (canEditPosX || canEditPosY) {
            const cameraDir = new THREE.Vector3();
            camera.getWorldDirection(cameraDir);
            const dragPlane = new THREE.Plane(cameraDir, 0);
            dragPlane.setFromNormalAndCoplanarPoint(cameraDir, dragStartPos);

            raycaster.setFromCamera(mouse, camera);
            const newWorldPos = new THREE.Vector3();
            raycaster.ray.intersectPlane(dragPlane, newWorldPos);
            if (newWorldPos) {
                worldDeltaXY = newWorldPos.clone().sub(dragStartPos);
            }
        }

        // Z Movement (Screen Vertical)
        const worldDeltaZ = canEditPosZ ? -(screenDelta.y / rect.height) * 150 : 0;

        const newPos = new THREE.Vector3(
            canEditPosX ? dragStartPos.x + worldDeltaXY.x : dragStartPos.x,
            canEditPosY ? dragStartPos.y + worldDeltaXY.y : dragStartPos.y,
            canEditPosZ ? dragStartPos.z + worldDeltaZ : dragStartPos.z
        );

        targetMesh.position.copy(newPos);

        // Sync UI
        const configTarget = isText ? activeModelConfig.text : activeModelConfig.logo;
        const uiPrefix = isText ? '#text-pos-' : '#logo-pos-';
        
        if (activeModelConfig && configTarget) {
            configTarget.position = { x: newPos.x, y: newPos.y, z: newPos.z };
            if (canEditPosX) $(uiPrefix + 'x').val(newPos.x.toFixed(2));
            if (canEditPosY) $(uiPrefix + 'y').val(newPos.y.toFixed(2));
            if (canEditPosZ) $(uiPrefix + 'z').val(newPos.z.toFixed(2));
        }
        
        event.preventDefault();
    });

    canvas.addEventListener('mouseup', () => {
        isDraggingText = false;
        isDraggingLogo = false;
        if (controls) controls.enabled = true;
    });
}

// UPDATE TEXT FONT
function updateTextFont(fontName) {
    if (!textMesh || !mesh) return;

    // Font URLs mapping
    const fontUrls = {
        'helvetiker_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
        'helvetiker_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json',
        'optimer_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/optimer_bold.typeface.json',
        'optimer_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/optimer_regular.typeface.json',
        'droid_sans_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/droid_sans_bold.typeface.json',
        'droid_sans_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/droid_sans_regular.typeface.json'
    };

    const fontUrl = fontUrls[fontName] || fontUrls['helvetiker_bold'];
    const currentText = $('#custom-text-input').val();

    if (!currentText || currentText === "") return;

    const cfg = activeModelConfig.text;
    cfg.fontUrl = fontUrl;

    // Re-render text with new font
    updateCustomText(currentText);
}

// UPDATE TEXT ROTATION (in degrees)
function updateTextRotation() {
    if (!textMesh) return;

    // Convert degrees from UI to radians for Three.js
    const rotX = (parseFloat($('#text-rotation-x').val()) * Math.PI) / 180;
    const rotY = (parseFloat($('#text-rotation-y').val()) * Math.PI) / 180;
    const rotZ = (parseFloat($('#text-rotation-z').val()) * Math.PI) / 180;
    
    textMesh.rotation.x = rotX;
    textMesh.rotation.y = rotY;
    textMesh.rotation.z = rotZ;

    if (activeModelConfig && activeModelConfig.text) {
        // Store as RADIANS in config
        activeModelConfig.text.rotation = {
            x: rotX,
            y: rotY,
            z: rotZ
        };
    }
}

// UPDATE TEXT POSITION (World Coordinates)
function updateTextPosition() {
    if (!textMesh) return;

    const posX = parseFloat($('#text-pos-x').val()) || 0;
    const posY = parseFloat($('#text-pos-y').val()) || 0;
    const posZ = parseFloat($('#text-pos-z').val()) || 0;

    textMesh.position.set(posX, posY, posZ);

    if (activeModelConfig && activeModelConfig.text) {
        activeModelConfig.text.position = {
            x: posX,
            y: posY,
            z: posZ
        };
    }
}

function getVolume(geometry) {
    if(geometry.index) geometry = geometry.toNonIndexed();
    const pos = geometry.attributes.position;
    let vol = 0;
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();
    for(let i=0; i<pos.count; i+=3){
        p1.fromBufferAttribute(pos, i);
        p2.fromBufferAttribute(pos, i+1);
        p3.fromBufferAttribute(pos, i+2);
        vol += p1.dot(p2.cross(p3)) / 6.0;
    }
    return Math.abs(vol);
}

function formatTL(price) {
    if (isNaN(price)) return "₺0.00";
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

function calculatePrice() {
    let vol = $('#model-vol').data('raw');
    if(vol === undefined || vol === null || isNaN(vol)) vol = 0;

    const materialFactor = parseFloat($('#material-select').val());
    const infillVal = parseFloat($('#pro-infill').val());
    const infillFactor = infillVal / 20; 
    const deliveryFactor = parseFloat($('input[name="delivery"]:checked').val());
    let quantity = parseInt($('#quantity-input').val());
    if (isNaN(quantity) || quantity < 1) quantity = 1;

    let unitPrice = vol * BASE_PRICE_PER_CM3 * materialFactor * infillFactor;
    
    if (vol > 0 && unitPrice < 50) unitPrice = 50; 
    if (vol === 0) unitPrice = 0;

    let totalPrice = unitPrice * quantity * deliveryFactor;
    $('#price-display').text(formatTL(totalPrice));
}

async function addToCart() {
    const $btn = $('#add-to-cart');
    
    $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> İşleniyor...');

    try {
        // 1. Capture Snapshot
        renderer.render(scene, camera);
        const snapshot = renderer.domElement.toDataURL('image/png');

        // 2. Prepare Minimal User Data
        const name = $('#file-name-display').text() || "Özel Model";
        const priceText = $('#price-display').text();
        const price = parseFloat(priceText.replace('₺', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        const mode = $('.tab-btn.active').text();

        // Extract strictly user-defined values
        const customizationData = {
            // Reference to base model
            plateId: currentLibraryModel ? currentLibraryModel.id : "custom_upload", 
            
            // Production Settings
            production: {
                material: $('#material-select').val(),
                infill: $('#infill-select').val(),
                colorName: $('.color-option.selected').data('color') || "Default",
                colorHex: $('.color-option.selected').data('hex') || "#333",
                quantity: parseInt($('#quantity-input').val()) || 1,
                delivery: $('input[name="delivery"]:checked').val()
            }
        };

        // Add Text Data if exists
        if (activeModelConfig && activeModelConfig.text) {
            customizationData.text = {
                content: $('#custom-text-input').val() || "",
                font: $('#text-font-select').val(),
                size: parseFloat($('#text-size-input').val()) || 10,
                depth: parseFloat($('#text-depth-input').val()) || 4,
                spacing: parseFloat($('#letter-spacing-input').val()) || 0,
                align: $('input[name="text-align"]:checked').val(),
                color: activeModelConfig.text.color, 
                // Crucial Transformation Data
                position: activeModelConfig.text.position, // {x, y, z}
                rotation: activeModelConfig.text.rotation  // {x, y, z}
            };
        }

        // Add Logo Data if exists
        if (activeModelConfig && activeModelConfig.logo) {
            customizationData.logo = {
                svgContent: activeModelConfig.logo._lastSvg || null, 
                scale: parseFloat($('#logo-size-input').val()) || 1,
                depth: parseFloat($('#logo-depth-input').val()) || 4,
                color: activeModelConfig.logo.color,
                // Crucial Transformation Data
                position: activeModelConfig.logo.position,
                rotation: activeModelConfig.logo.rotation
            };
        }

        const timestamp = Date.now();
        const dateStr = new Date().toLocaleString('tr-TR');

        const modelToSave = {
            id: timestamp,
            name: name,
            desc: "Kullanıcı tarafından özelleştirildi (" + dateStr + ")",
            price: price,
            images: [snapshot],
            stl: currentLibraryModel ? currentLibraryModel.stl : null, 
            sellCount: 0,
            isCustomizable: true,
            customConfig: customizationData, // Saved cleaned data
            createdAt: timestamp
        };

        // 3. Save to Firebase
        const user = auth.currentUser;
        
        if (!user) {
            showToast("Oturum açılıyor, lütfen tekrar deneyin.", "info");
            $btn.prop('disabled', false).text('Sepete Ekle');
            return;
        }

        const dbPath = `users/${user.uid}/saved_models`;
        const newRef = push(ref(db, dbPath));
        await set(newRef, modelToSave);

        // 4. Add to Local Cart
        const cartItem = { 
            name: name, 
            price: price, 
            mode: mode, 
            formattedPrice: priceText,
            date: dateStr,
            image: snapshot, 
            isLibrary: !!currentLibraryModel,
            libraryId: currentLibraryModel ? currentLibraryModel.id : null,
            configuration: customizationData, // Use the same clean data
            firebaseId: newRef.key 
        };
        
        cart.push(cartItem);
        saveCart(); 
        renderCart();

        // 5. UI Feedback
        showToast("Sepete Eklendi!", "success");
        setTimeout(() => {
            $btn.prop('disabled', false).text('Sepete Ekle').css('background-color', '');
        }, 1500);

    } catch (error) {
        console.error("Cart/Save Error:", error);
        $btn.prop('disabled', false).text('Hata');
        showToast("İşlem hatası: " + error.message, "error");
    }
}

function saveCart() {
    // Save all items including locally created ones
    localStorage.setItem('engrare_cart', JSON.stringify(cart));
    $('#cart-badge').text(cart.length);
}

function loadCart() {
    const stored = localStorage.getItem('engrare_cart');
    if (stored) {
        try {
            cart = JSON.parse(stored);
            $('#cart-badge').text(cart.length);
            renderCart();
        } catch(e) {
            console.error("Cart load failed", e);
        }
    }
}

function renderCart() {
    const $area = $('#cart-items-area');
    $area.empty();
    
    if(cart.length === 0) {
        $area.html('<div style="text-align:center; padding:20px; color:#999">Sepet boş.</div>');
        $('#val-subtotal').text(formatTL(0));
        $('#val-total').text(formatTL(50)); 
        return;
    }

    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price;
        
        // Use snapshot or default image
        const imgUrl = item.image || "./content/product2.jpeg";

        $area.append(`
            <div class="cart-item">
                <div style="display:flex; align-items:center; gap: 15px;">
                    <img src="${imgUrl}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; background: #f9f9f9;">
                    <div class="info">
                        <div style="font-weight:600">${item.name}</div>
                        <div style="font-size:0.8rem; color:#666">${item.mode}</div>
                        <div style="font-size:0.75rem; color:#999; margin-top:4px;">${item.date}</div>
                    </div>
                </div>
                <div class="price-action">
                    <span style="font-weight:500; margin-right:15px">${item.formattedPrice}</span>
                    <button class="remove-btn" data-index="${index}" style="color:red; background:none; border:none; cursor:pointer;">X</button>
                </div>
            </div>
        `);
    });

    const shipping = 50.00;
    $('#val-subtotal').text(formatTL(sub));
    $('#shipping-display').text(formatTL(shipping));
    $('#val-total').text(formatTL(sub + shipping));
}