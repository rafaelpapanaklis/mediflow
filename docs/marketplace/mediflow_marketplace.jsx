import React, { useState, useMemo } from 'react';
import {
  Stethoscope, Calendar, FileText, BarChart3, Package, Settings, Search,
  Activity, Smile, Baby, Heart, Sparkles, Apple,
  Bone, Syringe, ChevronRight, Check, X, Zap, CreditCard,
  TrendingUp, Users, Camera, Pause, Receipt, Shield, ArrowRight,
  Layers, Wrench, MessageCircle, Award, Image as ImageIcon,
  ShoppingCart, Plus, Trash2, Building2, Lock, Info, Gift, ArrowLeft,
  Clock, AlertTriangle, PartyPopper, Lightbulb, Crown
} from 'lucide-react';

export default function MediFlowMarketplace() {
  const [screen, setScreen] = useState(1);
  const [billingCycle, setBillingCycle] = useState('annual');
  const [cart, setCart] = useState(['orthodontics', 'general-dentistry', 'periodontics']);

  // Estado del trial. trialDay simula el día actual del trial (0-15)
  // 14 = expirado. Para que veas todos los estados visuales fácilmente.
  const [trialDay, setTrialDay] = useState(2);
  const daysLeft = Math.max(0, 14 - trialDay);
  const trialExpired = daysLeft === 0;

  const addToCart = (id) => { if (!cart.includes(id)) setCart([...cart, id]); };
  const removeFromCart = (id) => setCart(cart.filter(c => c !== id));

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      {/* Toolbar de preview */}
      <div className="sticky top-0 z-50 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 shadow-sm flex-wrap">
        <span className="text-xs font-medium text-slate-500">PREVIEW · Pantalla:</span>
        <div className="flex items-center gap-1.5">
          {[
            { n: 1, label: 'Marketplace' },
            { n: 2, label: 'Detalle' },
            { n: 3, label: 'Activación' },
            { n: 4, label: 'Carrito' },
            { n: 5, label: 'Bloqueo trial' }
          ].map(t => (
            <button
              key={t.n}
              onClick={() => setScreen(t.n)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                screen === t.n ? 'bg-slate-900 text-white font-medium' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.n}. {t.label}
            </button>
          ))}
        </div>

        {/* Simulador de día del trial */}
        <div className="ml-auto flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-md">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-700">Día del trial:</span>
          <input
            type="range"
            min="0"
            max="15"
            value={trialDay}
            onChange={(e) => setTrialDay(parseInt(e.target.value))}
            className="w-32 accent-slate-900"
          />
          <span className="text-xs font-mono font-semibold text-slate-900 min-w-[60px]">
            Día {trialDay} {trialExpired ? '· Expirado' : `· ${daysLeft}d restantes`}
          </span>
        </div>
      </div>

      {/* Si el trial expiró y no está en el carrito, forzar pantalla de bloqueo */}
      {trialExpired && screen !== 4 && screen !== 5 && (
        <ExpiredOverlay onAction={() => setScreen(5)} />
      )}

      <div className="flex">
        <Sidebar cartCount={cart.length} onCartClick={() => setScreen(4)} daysLeft={daysLeft} trialExpired={trialExpired} />

        <main className="flex-1 min-w-0">
          {/* Banner de trial persistente arriba de TODAS las pantallas */}
          {!trialExpired && screen !== 5 && <TrialBanner daysLeft={daysLeft} onUpgrade={() => setScreen(1)} />}

          {screen === 1 && (
            <MarketplaceScreen
              cart={cart}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
              onModuleClick={() => setScreen(2)}
              daysLeft={daysLeft}
              trialExpired={trialExpired}
            />
          )}
          {screen === 2 && <ModuleDetailScreen onBack={() => setScreen(1)} />}
          {screen === 3 && <ActivationModal onClose={() => setScreen(1)} billingCycle={billingCycle} setBillingCycle={setBillingCycle} />}
          {screen === 4 && (
            <CheckoutScreen cart={cart} removeFromCart={removeFromCart} billingCycle={billingCycle} setBillingCycle={setBillingCycle} onBack={() => setScreen(1)} />
          )}
          {screen === 5 && (
            <TrialExpiredScreen
              cart={cart}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
              onCheckout={() => setScreen(4)}
            />
          )}
        </main>

        {screen === 1 && cart.length > 0 && (
          <FloatingCart cart={cart} billingCycle={billingCycle} onClick={() => setScreen(4)} />
        )}
      </div>
    </div>
  );
}

// ============== TRIAL BANNER (persistente arriba de cada pantalla) ==============
function TrialBanner({ daysLeft, onUpgrade }) {
  // Escalada de urgencia según días restantes
  const isUrgent = daysLeft <= 3;
  const isWarning = daysLeft <= 7 && !isUrgent;

  if (isUrgent) {
    return (
      <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-600 text-white px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-sm font-semibold">¡Tu prueba termina en {daysLeft} día{daysLeft !== 1 ? 's' : ''}!</div>
            <div className="text-xs text-white/85">Compra los módulos que necesitas antes de perder el acceso · Tus datos se mantendrán</div>
          </div>
        </div>
        <button onClick={onUpgrade} className="bg-white text-red-700 hover:bg-red-50 font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 flex-shrink-0">
          Elegir módulos ahora
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (isWarning) {
    return (
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
            <Clock className="w-4 h-4" strokeWidth={2.5} />
          </div>
          <div className="text-sm font-medium">
            <strong>{daysLeft} días</strong> restantes en tu prueba gratuita · No olvides activar los módulos que más uses
          </div>
        </div>
        <button onClick={onUpgrade} className="bg-white/15 backdrop-blur hover:bg-white/25 font-medium px-3 py-1.5 rounded-md text-sm transition-colors flex-shrink-0">
          Ver módulos
        </button>
      </div>
    );
  }

  // Días 1-7: estado normal "promocional"
  return (
    <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
          <PartyPopper className="w-4 h-4 text-amber-200" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-semibold">Prueba gratis · Acceso completo a todos los módulos</div>
          <div className="text-xs text-white/85">Te quedan <strong className="text-white">{daysLeft} días</strong> · Sin tarjeta · Sin compromiso</div>
        </div>
      </div>
      <button onClick={onUpgrade} className="bg-white/15 backdrop-blur hover:bg-white/25 font-medium px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 flex-shrink-0">
        Explorar módulos
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============== EXPIRED OVERLAY (modal bloqueante si trial expira) ==============
function ExpiredOverlay({ onAction }) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="bg-gradient-to-br from-red-500 to-rose-600 px-6 py-5 text-white">
          <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" strokeWidth={2} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Tu prueba gratuita terminó</h2>
          <p className="text-sm text-white/85 mt-1">Compra al menos un módulo para continuar usando MediFlow.</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-700">
              <strong className="text-slate-900">Tus datos están seguros.</strong> Toda la información de pacientes, citas y registros se conserva intacta. Al comprar módulos, podrás acceder a ella de inmediato.
            </div>
          </div>
          <button onClick={onAction} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
            Elegir mis módulos
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== SIDEBAR ==============
function Sidebar({ cartCount, onCartClick, daysLeft, trialExpired }) {
  const items = [
    { icon: Users, label: 'Pacientes' },
    { icon: Calendar, label: 'Citas' },
    { icon: Receipt, label: 'Facturación' },
    { icon: BarChart3, label: 'Reportes' },
    { icon: Package, label: 'Marketplace', active: true },
    { icon: Settings, label: 'Configuración' },
  ];

  return (
    <aside className="w-60 bg-white border-r border-slate-200 min-h-[calc(100vh-49px)] flex flex-col flex-shrink-0">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold text-slate-900 text-[15px] tracking-tight">MediFlow</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {items.map((item, i) => (
          <button key={i} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
            item.active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
          }`}>
            <item.icon className="w-[18px] h-[18px]" strokeWidth={item.active ? 2.2 : 1.8} />
            {item.label}
          </button>
        ))}

        <button onClick={onCartClick} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-50 transition-colors mt-2">
          <ShoppingCart className="w-[18px] h-[18px]" strokeWidth={1.8} />
          <span className="flex-1 text-left">Carrito</span>
          {cartCount > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] text-center">{cartCount}</span>
          )}
        </button>
      </nav>

      {/* Mini status del trial en sidebar */}
      <div className="px-3 pb-3">
        {trialExpired ? (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-3.5 h-3.5 text-red-600" />
              <div className="text-xs font-semibold text-red-700">Prueba expirada</div>
            </div>
            <div className="text-xs text-red-600/80">Compra módulos para continuar</div>
          </div>
        ) : (
          <div className={`rounded-lg p-3 border ${
            daysLeft <= 3 ? 'bg-red-50 border-red-100' :
            daysLeft <= 7 ? 'bg-amber-50 border-amber-100' :
            'bg-violet-50 border-violet-100'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Clock className={`w-3.5 h-3.5 ${
                daysLeft <= 3 ? 'text-red-600' :
                daysLeft <= 7 ? 'text-amber-600' :
                'text-violet-600'
              }`} />
              <div className={`text-xs font-semibold ${
                daysLeft <= 3 ? 'text-red-700' :
                daysLeft <= 7 ? 'text-amber-700' :
                'text-violet-700'
              }`}>
                Trial · {daysLeft}d restantes
              </div>
            </div>
            <div className={`text-xs ${
              daysLeft <= 3 ? 'text-red-600/80' :
              daysLeft <= 7 ? 'text-amber-700/80' :
              'text-violet-700/80'
            }`}>
              Acceso completo a todo
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-slate-50 cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-semibold">RP</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-900 truncate">Dr. Rafael Pérez</div>
            <div className="text-xs text-slate-500 truncate">Clínica Dental Mérida</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ============== MINI CART FLOTANTE ==============
function FloatingCart({ cart, billingCycle, onClick }) {
  const total = useMemo(() => calculateTotal(cart, billingCycle), [cart, billingCycle]);
  const tier = getDiscountTier(cart.length);

  return (
    <div className="fixed bottom-6 right-6 z-30">
      <button onClick={onClick} className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-2xl shadow-slate-900/20 px-5 py-4 flex items-center gap-4 transition-all hover:scale-105">
        <div className="relative">
          <ShoppingCart className="w-5 h-5" strokeWidth={2} />
          <span className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{cart.length}</span>
        </div>
        <div className="text-left">
          <div className="text-xs text-slate-400">{tier ? `${tier.discount}% descuento aplicado` : `${cart.length} módulo${cart.length > 1 ? 's' : ''}`}</div>
          <div className="text-sm font-semibold">${total.final.toFixed(0)} MXN/{billingCycle === 'annual' ? 'año' : 'mes'}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </button>
    </div>
  );
}

// ============== PANTALLA 1: MARKETPLACE ==============
function MarketplaceScreen({ cart, addToCart, removeFromCart, onModuleClick, daysLeft, trialExpired }) {
  const [activeTab, setActiveTab] = useState('Todos');
  const tabs = ['Todos', 'Dental', 'Medicina general', 'Especialidades médicas', 'Estética', 'Terapéuticas'];

  return (
    <div className="px-8 py-7 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight leading-tight">Marketplace de módulos</h1>
        <p className="text-slate-500 mt-1 text-[15px]">
          {trialExpired
            ? 'Tu prueba terminó. Activa los módulos que necesitas para continuar.'
            : `Estás probando todos los módulos gratis. Compra los que más uses para conservarlos después del día 14.`}
        </p>
      </div>

      <DiscountTiersBar cartCount={cart.length} />

      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-lg overflow-x-auto">
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-3.5 py-1.5 text-sm rounded-md whitespace-nowrap transition-all ${
              activeTab === t ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}>{t}</button>
          ))}
        </div>
        <div className="relative flex-shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="Buscar módulo..." className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-md text-sm w-64 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 pb-24">
        {modules.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            inCart={cart.includes(m.id)}
            onAddToCart={() => addToCart(m.id)}
            onRemoveFromCart={() => removeFromCart(m.id)}
            onDetailClick={onModuleClick}
            inTrial={!trialExpired}
            trialExpired={trialExpired}
          />
        ))}
      </div>
    </div>
  );
}

// ============== BARRA DE DESCUENTOS ==============
function DiscountTiersBar({ cartCount }) {
  const tiers = [
    { count: 3, discount: 10, label: '3 módulos' },
    { count: 5, discount: 15, label: '5 módulos' },
    { count: 10, discount: 25, label: '10 módulos' },
  ];

  const currentTier = tiers.slice().reverse().find(t => cartCount >= t.count);
  const nextTier = tiers.find(t => cartCount < t.count);
  const progress = nextTier ? (cartCount / nextTier.count) * 100 : 100;

  return (
    <div className="mb-7 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-500/20 to-cyan-500/0 rounded-full blur-3xl -mr-20 -mt-20"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-violet-500/15 to-purple-500/0 rounded-full blur-3xl -ml-20 -mb-20"></div>

      <div className="relative">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
              <Gift className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Descuentos por paquete</h2>
              <p className="text-sm text-slate-300 mt-0.5">Más módulos = más ahorro. Combina las especialidades que tu clínica necesite.</p>
            </div>
          </div>
          {currentTier && (
            <div className="bg-emerald-500/20 backdrop-blur border border-emerald-400/30 rounded-lg px-3 py-2 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-300" strokeWidth={3} />
              <span className="text-sm font-medium text-emerald-100">{currentTier.discount}% activo</span>
            </div>
          )}
        </div>

        <div className="relative mb-3 px-2">
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 rounded-full transition-all duration-500" style={{ width: `${Math.min(progress, 100)}%` }}></div>
          </div>

          <div className="absolute inset-0 flex items-center">
            {tiers.map((t, i) => {
              const reached = cartCount >= t.count;
              return (
                <div key={i} className="absolute" style={{ left: `calc(${(t.count / 10) * 100}% - 8px)`, top: '0px' }}>
                  <div className={`w-4 h-4 rounded-full border-2 transition-all ${
                    reached ? 'bg-emerald-400 border-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-slate-800 border-white/30'
                  }`}>
                    {reached && <Check className="w-2.5 h-2.5 text-white m-0.5" strokeWidth={4} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 mt-5 gap-4">
          {tiers.map((t, i) => {
            const reached = cartCount >= t.count;
            return (
              <div key={i} className={`text-center p-3 rounded-lg transition-all ${reached ? 'bg-white/5' : ''}`}>
                <div className={`text-3xl font-bold tracking-tight ${reached ? 'text-white' : 'text-slate-500'}`}>{t.discount}%</div>
                <div className={`text-xs mt-1 ${reached ? 'text-slate-200' : 'text-slate-500'}`}>{t.label}</div>
              </div>
            );
          })}
        </div>

        {nextTier && (
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-sm">
            <Info className="w-4 h-4 text-blue-300 flex-shrink-0" />
            <span className="text-slate-300">
              Agrega <strong className="text-white">{nextTier.count - cartCount} módulo{nextTier.count - cartCount > 1 ? 's' : ''} más</strong> para desbloquear el <strong className="text-white">{nextTier.discount}% de descuento</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== MODULE CARD ==============
function ModuleCard({ module: m, inCart, onAddToCart, onRemoveFromCart, onDetailClick, inTrial, trialExpired }) {
  const Icon = m.icon;

  // Durante trial activo: TODOS los módulos en estado "trial · disponible"
  // Después del trial: solo los comprados son comprados, el resto bloqueado
  const isPurchased = m.status === 'purchased';
  const showAsTrial = inTrial && !isPurchased;
  const isLocked = trialExpired && !isPurchased;

  const categoryColors = {
    Dental: 'bg-blue-50 text-blue-700', Pediatría: 'bg-pink-50 text-pink-700',
    Cardiología: 'bg-red-50 text-red-700', Dermatología: 'bg-orange-50 text-orange-700',
    Ginecología: 'bg-purple-50 text-purple-700', Nutrición: 'bg-green-50 text-green-700',
    Estética: 'bg-fuchsia-50 text-fuchsia-700',
  };

  // Badge config según estado
  let badge;
  if (isPurchased) {
    badge = { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Comprado' };
  } else if (isLocked) {
    badge = { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Bloqueado' };
  } else if (showAsTrial) {
    badge = { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500', label: 'Trial activo' };
  } else {
    badge = { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Disponible' };
  }

  return (
    <div className={`bg-white border rounded-xl p-5 transition-all flex flex-col relative ${
      inCart ? 'border-blue-400 ring-2 ring-blue-100 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
    } ${isLocked ? 'opacity-75' : ''}`}>

      {/* Overlay de candado si está bloqueado */}
      {isLocked && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-red-600" />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center ${isLocked ? 'grayscale opacity-60' : ''}`}>
          <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} />
        </div>
        {!isLocked && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${badge.bg} ${badge.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}></span>
            {badge.label}
          </div>
        )}
      </div>

      <div className="mb-2">
        <h3 className={`font-semibold text-[15px] ${isLocked ? 'text-slate-500' : 'text-slate-900'}`}>{m.name}</h3>
        <span className={`inline-block mt-1.5 text-[11px] px-1.5 py-0.5 rounded ${categoryColors[m.category] || 'bg-slate-100 text-slate-600'}`}>
          {m.category}
        </span>
      </div>

      <p className={`text-sm leading-relaxed mb-3 ${isLocked ? 'text-slate-400' : 'text-slate-600'}`}>{m.description}</p>

      <ul className="space-y-1.5 mb-4 flex-1">
        {m.features.map((f, i) => (
          <li key={i} className={`flex items-start gap-2 text-xs ${isLocked ? 'text-slate-400' : 'text-slate-600'}`}>
            <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isLocked ? 'text-slate-300' : 'text-emerald-500'}`} strokeWidth={2.5} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className={`text-lg font-semibold ${isLocked ? 'text-slate-500' : 'text-slate-900'}`}>${m.price}</span>
            <span className="text-xs text-slate-500 ml-1">MXN/mes</span>
          </div>
          {isPurchased && (
            <button onClick={onDetailClick} className="text-sm font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 transition-colors">
              Gestionar
            </button>
          )}
        </div>

        {isPurchased ? (
          <div className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center gap-2 cursor-not-allowed">
            <Check className="w-4 h-4" strokeWidth={2.5} />
            Ya comprado · Activo en tu cuenta
          </div>
        ) : (
          inCart ? (
            <button onClick={onRemoveFromCart} className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-2">
              <Check className="w-4 h-4" strokeWidth={2.5} />
              En el carrito
            </button>
          ) : (
            <button onClick={onAddToCart} className={`w-full text-sm font-medium px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              isLocked
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}>
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              {isLocked ? 'Comprar para desbloquear' : 'Agregar al carrito'}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ============== PANTALLA 5: TRIAL EXPIRADO (vista completa de bloqueo) ==============
function TrialExpiredScreen({ cart, addToCart, removeFromCart, onCheckout }) {
  // Top 3 módulos sugeridos (más usados durante el trial - simulado)
  const suggested = ['orthodontics', 'general-dentistry', 'periodontics'];

  return (
    <div className="px-8 py-10 max-w-[1100px]">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-8 text-white relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-blue-500/20 to-cyan-500/0 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-violet-500/20 to-purple-500/0 rounded-full blur-3xl -ml-20 -mb-20"></div>

        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-5">
            <Crown className="w-7 h-7 text-amber-300" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Tu prueba gratuita terminó</h1>
          <p className="text-slate-300 text-[15px] max-w-2xl leading-relaxed">
            Llevas 14 días explorando MediFlow. Para seguir, elige los módulos que necesita tu clínica. Puedes empezar con uno y agregar más después.
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3 max-w-2xl">
            <TrialStat icon={Users} label="Pacientes registrados" value="47" />
            <TrialStat icon={FileText} label="Notas creadas" value="128" />
            <TrialStat icon={Camera} label="Fotos clínicas" value="89" />
          </div>

          <div className="mt-6 flex items-center gap-2 text-sm text-slate-300">
            <Shield className="w-4 h-4 text-emerald-400" />
            Toda esta información se conserva intacta y estará disponible al activar tus módulos.
          </div>
        </div>
      </div>

      {/* Tu uso durante el trial - sugerencias */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-900">Recomendado para ti</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">Basado en cómo usaste MediFlow durante tu prueba, estos son los módulos que más te beneficiarían.</p>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {suggested.map(id => {
            const m = modules.find(x => x.id === id);
            const inCart = cart.includes(id);
            return (
              <SuggestedCard
                key={id}
                module={m}
                inCart={inCart}
                onAdd={() => addToCart(id)}
                onRemove={() => removeFromCart(id)}
              />
            );
          })}
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
          <Gift className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <strong>Tip:</strong> Agrega 3 módulos para desbloquear <strong>10% de descuento</strong> automático. Si combinas con pago anual, ahorras hasta <strong>$1,400 MXN</strong>.
          </div>
        </div>
      </div>

      {/* Todos los módulos con estado bloqueado */}
      <div className="mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Todos los módulos disponibles</h2>
        <p className="text-sm text-slate-500 mb-4">Selecciona los que necesites. Puedes activarlos uno por uno o en paquete.</p>

        <div className="grid grid-cols-3 gap-4">
          {modules.filter(m => !suggested.includes(m.id)).map(m => (
            <CompactModuleCard
              key={m.id}
              module={m}
              inCart={cart.includes(m.id)}
              onAdd={() => addToCart(m.id)}
              onRemove={() => removeFromCart(m.id)}
            />
          ))}
        </div>
      </div>

      {/* CTA fijo al final */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sticky bottom-6 shadow-xl flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">{cart.length} módulo{cart.length !== 1 ? 's' : ''} seleccionado{cart.length !== 1 ? 's' : ''}</div>
          <div className="text-xl font-semibold text-slate-900 tracking-tight">
            {cart.length > 0
              ? `$${calculateTotal(cart, 'monthly').final.toFixed(0)} MXN/mes`
              : 'Selecciona al menos un módulo'}
          </div>
        </div>
        <button
          onClick={onCheckout}
          disabled={cart.length === 0}
          className={`font-medium px-5 py-3 rounded-lg transition-colors flex items-center gap-2 text-sm ${
            cart.length === 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-slate-900 hover:bg-slate-800 text-white'
          }`}
        >
          Continuar al pago
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function TrialStat({ icon: Icon, label, value }) {
  return (
    <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function SuggestedCard({ module: m, inCart, onAdd, onRemove }) {
  const Icon = m.icon;
  return (
    <div className={`relative border-2 rounded-xl p-4 transition-all ${
      inCart ? 'border-blue-500 bg-blue-50/30 shadow-md' : 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
    }`}>
      <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
        Recomendado
      </div>
      <div className="flex items-start gap-3 mb-3 mt-1">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 text-sm truncate">{m.name}</h3>
          <div className="text-xs text-slate-500 mt-0.5">{m.category}</div>
        </div>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed mb-3">{m.description}</p>
      <div className="flex items-center justify-between pt-3 border-t border-slate-200/60">
        <div>
          <span className="text-base font-semibold text-slate-900">${m.price}</span>
          <span className="text-xs text-slate-500 ml-1">/mes</span>
        </div>
        {inCart ? (
          <button onClick={onRemove} className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors flex items-center gap-1">
            <Check className="w-3 h-3" strokeWidth={3} />
            Agregado
          </button>
        ) : (
          <button onClick={onAdd} className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" strokeWidth={3} />
            Agregar
          </button>
        )}
      </div>
    </div>
  );
}

function CompactModuleCard({ module: m, inCart, onAdd, onRemove }) {
  const Icon = m.icon;
  return (
    <div className={`bg-white border rounded-xl p-4 transition-all ${
      inCart ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
    }`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-[18px] h-[18px] ${m.iconColor}`} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-900 text-sm truncate">{m.name}</h3>
          <div className="text-xs text-slate-500 mt-0.5">{m.category}</div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-base font-semibold text-slate-900">${m.price}</span>
          <span className="text-xs text-slate-500 ml-1">/mes</span>
        </div>
        {inCart ? (
          <button onClick={onRemove} className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-1">
            <Check className="w-3 h-3" strokeWidth={3} />
            Agregado
          </button>
        ) : (
          <button onClick={onAdd} className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" strokeWidth={3} />
            Agregar
          </button>
        )}
      </div>
    </div>
  );
}

// ============== PANTALLA 4: CHECKOUT (sin cambios) ==============
function CheckoutScreen({ cart, removeFromCart, billingCycle, setBillingCycle, onBack }) {
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [step, setStep] = useState('cart');

  const cartItems = useMemo(() => modules.filter(m => cart.includes(m.id)), [cart]);
  const totals = useMemo(() => calculateTotal(cart, billingCycle), [cart, billingCycle]);
  const tier = getDiscountTier(cart.length);

  if (step === 'success') return <SuccessScreen onBack={onBack} cart={cartItems} totals={totals} billingCycle={billingCycle} />;
  if (cart.length === 0) return <EmptyCart onBack={onBack} />;

  return (
    <div className="px-8 py-7 max-w-[1300px]">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-900 mb-5 flex items-center gap-1 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Seguir explorando módulos
      </button>

      <div className="mb-7">
        <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight leading-tight">Tu carrito</h1>
        <p className="text-slate-500 mt-1 text-[15px]">
          {cart.length} módulo{cart.length > 1 ? 's' : ''} seleccionado{cart.length > 1 ? 's' : ''}
          {tier && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-xs font-medium">
              <Gift className="w-3 h-3" />
              {tier.discount}% de descuento aplicado
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Módulos seleccionados</h2>
              <span className="text-xs text-slate-500">{cart.length} de {modules.length}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {cartItems.map(item => (
                <CartItem key={item.id} item={item} onRemove={() => removeFromCart(item.id)} billingCycle={billingCycle} />
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Frecuencia de cobro</h2>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setBillingCycle('monthly')} className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                billingCycle === 'monthly' ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <div className="text-xs font-medium text-slate-500 mb-1">Mensual</div>
                <div className="text-xl font-semibold text-slate-900">${totals.subtotalMonthly.toFixed(0)}</div>
                <div className="text-xs text-slate-500">MXN/mes</div>
              </button>
              <button onClick={() => setBillingCycle('annual')} className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                billingCycle === 'annual' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <div className="absolute -top-2 right-3 px-2 py-0.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-[10px] font-semibold rounded-full">
                  AHORRA 2 MESES
                </div>
                <div className="text-xs font-medium text-slate-500 mb-1">Anual</div>
                <div className="text-xl font-semibold text-slate-900">${(totals.subtotalMonthly * 10).toFixed(0)}</div>
                <div className="text-xs text-blue-600 font-medium">MXN/año (paga 10 meses)</div>
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Método de pago</h2>
            <div className="space-y-2.5 mb-5">
              <PaymentOption id="card" selected={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')}
                icon={<CreditCard className="w-5 h-5" />} title="Tarjeta de crédito o débito"
                description="Visa, Mastercard, AMEX · Cobro automático cada periodo"
                logos={<div className="flex gap-1.5"><CardLogo type="visa" /><CardLogo type="mc" /><CardLogo type="amex" /></div>} />
              <PaymentOption id="paypal" selected={paymentMethod === 'paypal'} onClick={() => setPaymentMethod('paypal')}
                icon={<PayPalLogo />} title="PayPal"
                description="Paga con tu cuenta PayPal · Suscripción recurrente" />
              <PaymentOption id="spei" selected={paymentMethod === 'spei'} onClick={() => setPaymentMethod('spei')}
                icon={<Building2 className="w-5 h-5" />} title="Transferencia bancaria (SPEI)"
                description="Pago manual por periodo · Te enviamos los datos bancarios"
                badge="Solo anual" />
            </div>

            {paymentMethod === 'card' && <CardForm />}
            {paymentMethod === 'paypal' && <PayPalNotice />}
            {paymentMethod === 'spei' && <SpeiNotice />}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Datos fiscales (CFDI 4.0)</h2>
              <button className="text-xs font-medium text-blue-600 hover:text-blue-700">Editar</button>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Razón social</span><span className="font-medium text-slate-900">Clínica Dental Mérida SA de CV</span></div>
              <div className="flex justify-between"><span className="text-slate-500">RFC</span><span className="font-mono text-slate-900">CDM240115ABC</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Uso CFDI</span><span className="text-slate-900">G03 · Gastos en general</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Régimen fiscal</span><span className="text-slate-900">601 · General Personas Morales</span></div>
            </div>
          </div>
        </div>

        <div className="col-span-1">
          <div className="sticky top-[73px]">
            <OrderSummary cart={cartItems} totals={totals} tier={tier} billingCycle={billingCycle} onConfirm={() => setStep('success')} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CartItem({ item, onRemove, billingCycle }) {
  const Icon = item.icon;
  const price = parseInt(item.price);
  const periodPrice = billingCycle === 'annual' ? price * 10 : price;

  return (
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition-colors">
      <div className={`w-10 h-10 rounded-lg ${item.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${item.iconColor}`} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 text-sm">{item.name}</div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{item.description}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold text-slate-900">${periodPrice} MXN</div>
        <div className="text-xs text-slate-500">/{billingCycle === 'annual' ? 'año' : 'mes'}</div>
      </div>
      <button onClick={onRemove} className="text-slate-400 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50 transition-colors flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function OrderSummary({ cart, totals, tier, billingCycle, onConfirm }) {
  const period = billingCycle === 'annual' ? 'año' : 'mes';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Resumen del pedido</h2>
      </div>

      <div className="px-5 py-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Subtotal ({cart.length} módulos)</span>
          <span className="text-slate-900 font-medium">${totals.subtotal.toFixed(0)} MXN</span>
        </div>

        {billingCycle === 'annual' && (
          <div className="flex justify-between text-sm">
            <span className="text-blue-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Bonificación anual (2 meses)
            </span>
            <span className="text-blue-700 font-medium">−${totals.annualBonus.toFixed(0)} MXN</span>
          </div>
        )}

        {tier && (
          <div className="flex justify-between text-sm">
            <span className="text-emerald-700 flex items-center gap-1.5">
              <Gift className="w-3.5 h-3.5" />
              Descuento {tier.discount}% ({tier.label})
            </span>
            <span className="text-emerald-700 font-medium">−${totals.discount.toFixed(0)} MXN</span>
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-slate-600">IVA (16%)</span>
          <span className="text-slate-900 font-medium">${totals.tax.toFixed(0)} MXN</span>
        </div>

        <div className="border-t border-slate-100 pt-3 flex justify-between items-end">
          <div>
            <div className="text-xs text-slate-500">Total a pagar</div>
            <div className="text-xs text-slate-400 mt-0.5">por {period}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-slate-900 tracking-tight">
              ${totals.final.toFixed(0)}
              <span className="text-sm text-slate-500 font-normal ml-1">MXN</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-3">
        <button onClick={onConfirm} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm">
          <Lock className="w-4 h-4" strokeWidth={2.5} />
          Confirmar y pagar ${totals.final.toFixed(0)} MXN
        </button>

        <div className="space-y-1.5 pt-2">
          <div className="flex items-center gap-2 text-xs text-slate-600"><Shield className="w-3.5 h-3.5 text-emerald-500" /><span>Pago seguro · Encriptación SSL</span></div>
          <div className="flex items-center gap-2 text-xs text-slate-600"><Receipt className="w-3.5 h-3.5 text-emerald-500" /><span>CFDI 4.0 emitido automáticamente</span></div>
          <div className="flex items-center gap-2 text-xs text-slate-600"><X className="w-3.5 h-3.5 text-emerald-500" /><span>Sin permanencia · Cancela cuando quieras</span></div>
        </div>
      </div>
    </div>
  );
}

function PaymentOption({ selected, onClick, icon, title, description, logos, badge }) {
  return (
    <button onClick={onClick} className={`w-full p-4 rounded-lg border-2 text-left transition-all flex items-center gap-4 ${
      selected ? 'border-slate-900 bg-slate-50/50' : 'border-slate-200 hover:border-slate-300'
    }`}>
      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
        selected ? 'border-slate-900' : 'border-slate-300'
      }`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-slate-900"></div>}
      </div>
      <div className={`flex-shrink-0 ${selected ? 'text-slate-900' : 'text-slate-500'}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{title}</span>
          {badge && <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">{badge}</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
      </div>
      {logos && <div className="flex-shrink-0">{logos}</div>}
    </button>
  );
}

function CardForm() {
  return (
    <div className="bg-slate-50/60 rounded-lg p-4 border border-slate-100 space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-700 mb-1.5 block">Número de tarjeta</label>
        <div className="relative">
          <input type="text" placeholder="1234 5678 9012 3456" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 font-mono" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <CardLogo type="visa" /><CardLogo type="mc" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-700 mb-1.5 block">Vencimiento</label>
          <input type="text" placeholder="MM/AA" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1">CVV <Info className="w-3 h-3 text-slate-400" /></label>
          <input type="text" placeholder="123" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 font-mono" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-700 mb-1.5 block">Nombre del titular</label>
        <input type="text" placeholder="Como aparece en la tarjeta" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
        <Lock className="w-3 h-3" />
        Procesado de forma segura por Stripe · No almacenamos datos de tu tarjeta
      </div>
    </div>
  );
}

function PayPalNotice() {
  return (
    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5"><PayPalLogo /></div>
      <div className="text-xs text-slate-700 leading-relaxed">
        Al confirmar serás redirigido a <strong>PayPal</strong> para iniciar sesión y autorizar la suscripción recurrente. Podrás cancelarla en cualquier momento desde tu cuenta PayPal o desde MediFlow.
      </div>
    </div>
  );
}

function SpeiNotice() {
  return (
    <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 leading-relaxed">
          La transferencia SPEI solo está disponible para <strong>pago anual</strong> y requiere confirmación manual (24–48 horas).
        </div>
      </div>
      <div className="bg-white rounded-md p-3 text-xs space-y-1.5 mt-2 border border-amber-100">
        <div className="flex justify-between"><span className="text-slate-500">Banco</span><span className="font-medium">BBVA México</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Beneficiario</span><span className="font-medium">MediFlow Tecnología SA de CV</span></div>
        <div className="flex justify-between"><span className="text-slate-500">CLABE</span><span className="font-mono font-medium">012 180 01234567890 1</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Referencia</span><span className="font-mono font-medium text-amber-700">MF-2026-04839</span></div>
      </div>
    </div>
  );
}

function EmptyCart({ onBack }) {
  return (
    <div className="px-8 py-20 max-w-[600px] mx-auto text-center">
      <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-5">
        <ShoppingCart className="w-9 h-9 text-slate-400" />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-2">Tu carrito está vacío</h1>
      <p className="text-slate-500 mb-6">Explora el marketplace y agrega los módulos que tu clínica necesita.</p>
      <button onClick={onBack} className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm">
        Ir al marketplace
      </button>
    </div>
  );
}

function SuccessScreen({ onBack, cart, totals, billingCycle }) {
  return (
    <div className="px-8 py-16 max-w-[600px] mx-auto text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-emerald-600" strokeWidth={3} />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-2">¡Pago confirmado!</h1>
      <p className="text-slate-600 mb-1">Tus {cart.length} módulos están activándose ahora mismo.</p>
      <p className="text-sm text-slate-500 mb-8">Recibirás el CFDI 4.0 y la confirmación en tu correo en los próximos minutos.</p>

      <div className="bg-white border border-slate-200 rounded-xl p-5 text-left mb-6">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Resumen</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-600">Módulos activados</span><span className="font-medium">{cart.length}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">Frecuencia</span><span className="font-medium capitalize">{billingCycle === 'annual' ? 'Anual' : 'Mensual'}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">Total cobrado</span><span className="font-semibold text-emerald-700">${totals.final.toFixed(0)} MXN</span></div>
          <div className="flex justify-between"><span className="text-slate-600">Próximo cobro</span><span className="font-medium">{billingCycle === 'annual' ? '29 abr 2027' : '29 may 2026'}</span></div>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-center">
        <button onClick={onBack} className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm">
          Volver al marketplace
        </button>
        <button className="text-sm font-medium px-5 py-2.5 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5">
          <Receipt className="w-4 h-4" />
          Descargar CFDI
        </button>
      </div>
    </div>
  );
}

// ============== PANTALLA 2: DETALLE ==============
function ModuleDetailScreen({ onBack }) {
  const features = [
    { icon: Layers, title: 'Fases de tratamiento', desc: 'Alineación, nivelación, cierre y finalización' },
    { icon: FileText, title: 'Bitácora por cita', desc: 'Registro de alambre, brackets activados y fuerzas aplicadas' },
    { icon: Activity, title: 'Tracking de alineadores', desc: 'Número actual, refinamientos y attachments por paciente' },
    { icon: ImageIcon, title: 'Fotos clínicas comparativas', desc: 'Timeline intraoral, extraoral y de sonrisa' },
    { icon: BarChart3, title: 'Análisis cefalométrico', desc: 'Puntos, ángulos y mediciones básicas' },
    { icon: Wrench, title: 'Modelos de estudio', desc: 'Upload de archivos STL y fotografías' },
    { icon: MessageCircle, title: 'Recordatorios por WhatsApp', desc: 'Cambio de alineador y citas de control automáticos' },
    { icon: Award, title: 'Plan de tratamiento', desc: 'Duración estimada, fases y costo total al paciente' },
  ];

  return (
    <div className="px-8 py-7 max-w-[1100px]">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-900 mb-5 flex items-center gap-1 transition-colors">
        <ChevronRight className="w-4 h-4 rotate-180" />
        Marketplace
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Smile className="w-8 h-8 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Ortodoncia</h1>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-violet-50 text-violet-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                  Trial activo
                </div>
              </div>
              <p className="text-slate-500 text-[15px]">Suite completa para ortodoncistas: brackets convencionales, autoligado y alineadores.</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-slate-900">$329</div>
            <div className="text-sm text-slate-500">MXN/mes</div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Uso este mes</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Users} label="Pacientes con módulo" value="24" trend="+12%" color="blue" />
          <StatCard icon={FileText} label="Registros creados" value="87" trend="+34%" color="emerald" />
          <StatCard icon={Camera} label="Fotos clínicas subidas" value="142" trend="+28%" color="amber" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Qué incluye</h2>
        <p className="text-sm text-slate-500 mb-5">Todas las herramientas que un ortodoncista necesita en su día a día.</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {features.map((f, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <f.icon className="w-[18px] h-[18px] text-blue-600" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-slate-900">{f.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, trend, color }) {
  const colors = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600' };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${colors[color]} flex items-center justify-center`}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
        </div>
        <div className="flex items-center gap-1 text-xs font-medium text-emerald-600">
          <TrendingUp className="w-3 h-3" />{trend}
        </div>
      </div>
      <div className="text-2xl font-semibold text-slate-900 mb-1">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ============== PANTALLA 3: MODAL ACTIVACIÓN RÁPIDA ==============
function ActivationModal({ onClose, billingCycle, setBillingCycle }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" style={{ marginLeft: 240, marginTop: 49 }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 pt-6 pb-5 border-b border-slate-100 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Bone className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 mb-0.5">Comprar módulo</div>
              <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Implantología</h2>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="text-xs font-medium text-slate-700 uppercase tracking-wide mb-2 block">Frecuencia de cobro</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setBillingCycle('monthly')} className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                billingCycle === 'monthly' ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <div className="text-xs font-medium text-slate-500 mb-1">Mensual</div>
                <div className="text-xl font-semibold text-slate-900">$349</div>
                <div className="text-xs text-slate-500">MXN/mes</div>
              </button>
              <button onClick={() => setBillingCycle('annual')} className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                billingCycle === 'annual' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <div className="absolute -top-2 right-3 px-2 py-0.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-[10px] font-semibold rounded-full">AHORRA 2 MESES</div>
                <div className="text-xs font-medium text-slate-500 mb-1">Anual</div>
                <div className="text-xl font-semibold text-slate-900">$3,490</div>
                <div className="text-xs text-blue-600 font-medium">Equivale a $291/mes</div>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-slate-700 uppercase tracking-wide mb-2.5">Qué incluye</h3>
            <ul className="space-y-2">
              {['Registro por implante con marca, modelo, lote y torque','Timeline de osteointegración con alertas automáticas','Tracking de provisional, pilar y prótesis definitiva','Etiqueta de garantía exportable para el paciente'].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-2.5 h-2.5 text-blue-600" strokeWidth={3} />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-lg">
            <Shield className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 leading-relaxed">
              Se emitirá <strong>CFDI 4.0</strong> a tus datos fiscales registrados (RFC: <span className="font-mono">XAXX010101000</span>) automáticamente al confirmarse cada cobro.
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
            <CreditCard className="w-4 h-4" strokeWidth={2.5} />
            Comprar y activar
          </button>
          <p className="text-xs text-slate-500 text-center mt-2.5">Sin permanencia · Cancela cuando quieras</p>
        </div>
      </div>
    </div>
  );
}

// ============== HELPERS ==============
function getDiscountTier(count) {
  if (count >= 10) return { discount: 25, count: 10, label: '10+ módulos' };
  if (count >= 5) return { discount: 15, count: 5, label: '5+ módulos' };
  if (count >= 3) return { discount: 10, count: 3, label: '3+ módulos' };
  return null;
}

function calculateTotal(cartIds, billingCycle) {
  const items = modules.filter(m => cartIds.includes(m.id));
  const subtotalMonthly = items.reduce((sum, m) => sum + parseInt(m.price), 0);
  const subtotal = billingCycle === 'annual' ? subtotalMonthly * 12 : subtotalMonthly;
  const annualBonus = billingCycle === 'annual' ? subtotalMonthly * 2 : 0;

  const tier = getDiscountTier(cartIds.length);
  const baseAfterAnnual = subtotal - annualBonus;
  const discount = tier ? baseAfterAnnual * (tier.discount / 100) : 0;
  const afterDiscount = baseAfterAnnual - discount;
  const tax = afterDiscount * 0.16;
  const final = afterDiscount + tax;

  return { subtotal, subtotalMonthly, annualBonus, discount, tax, final };
}

function CardLogo({ type }) {
  const styles = {
    visa: { bg: 'bg-white border border-slate-200', text: 'text-blue-700', label: 'VISA' },
    mc: { bg: 'bg-white border border-slate-200', text: 'text-orange-600', label: 'MC' },
    amex: { bg: 'bg-blue-600', text: 'text-white', label: 'AMEX' },
  };
  const s = styles[type];
  return <div className={`${s.bg} ${s.text} text-[9px] font-bold px-1.5 py-1 rounded leading-none`}>{s.label}</div>;
}

function PayPalLogo() {
  return (
    <div className="flex items-center gap-0.5 font-bold text-sm">
      <span className="text-blue-700">Pay</span><span className="text-blue-400">Pal</span>
    </div>
  );
}

// ============== DATOS ==============
const modules = [
  { id: 'general-dentistry', name: 'Odontología General', category: 'Dental', icon: Smile, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Odontograma interactivo y catálogo completo de procedimientos.', features: ['Odontograma FDI / Universal / Palmer', 'Histórico por pieza dental', 'Catálogo de 80+ procedimientos'], price: '249', status: 'available' },
  { id: 'orthodontics', name: 'Ortodoncia', category: 'Dental', icon: Activity, iconBg: 'bg-cyan-50', iconColor: 'text-cyan-600', description: 'Suite para ortodoncistas: brackets, autoligado y alineadores.', features: ['Fases de tratamiento', 'Tracking de alineadores', 'Recordatorios automáticos por WhatsApp'], price: '329', status: 'available' },
  { id: 'periodontics', name: 'Periodoncia', category: 'Dental', icon: Layers, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Periodontograma de 6 sitios con índices y comparativos visuales.', features: ['Sondaje y sangrado', "Índices de placa y O'Leary", 'Programa de mantenimiento'], price: '279', status: 'available' },
  { id: 'endodontics', name: 'Endodoncia', category: 'Dental', icon: Syringe, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Diagrama de conductos por diente con protocolo de irrigación.', features: ['Conductos por diente', 'Longitud de trabajo', 'Protocolos de irrigación'], price: '279', status: 'available' },
  { id: 'implantology', name: 'Implantología', category: 'Dental', icon: Bone, iconBg: 'bg-violet-50', iconColor: 'text-violet-600', description: 'Registro por implante con timeline de osteointegración.', features: ['Marca, modelo, lote y torque', 'Timeline de osteointegración', 'Etiqueta de garantía'], price: '349', status: 'available' },
  { id: 'pediatric-dentistry', name: 'Odontopediatría', category: 'Dental', icon: Baby, iconBg: 'bg-pink-50', iconColor: 'text-pink-600', description: 'Curvas dentales, escala de Frankl y consentimiento parental.', features: ['Cronograma de erupción', 'Escala de Frankl', 'Consentimiento parental digital'], price: '249', status: 'available' },
  { id: 'pediatrics', name: 'Pediatría', category: 'Pediatría', icon: Baby, iconBg: 'bg-pink-50', iconColor: 'text-pink-600', description: 'Curvas OMS, vacunación mexicana e hitos del desarrollo.', features: ['Curvas de crecimiento OMS', 'Esquema de vacunación MX', 'Hitos del desarrollo'], price: '279', status: 'available' },
  { id: 'cardiology', name: 'Cardiología', category: 'Cardiología', icon: Heart, iconBg: 'bg-red-50', iconColor: 'text-red-600', description: 'TA con tendencias, ECG, score de riesgo cardiovascular.', features: ['Tensión arterial con gráfico', 'ECG y Holter', 'Score Framingham / ASCVD'], price: '349', status: 'available' },
  { id: 'dermatology', name: 'Dermatología', category: 'Dermatología', icon: Sparkles, iconBg: 'bg-orange-50', iconColor: 'text-orange-600', description: 'Mapa corporal de lesiones con fotos dermatoscópicas.', features: ['Mapa corporal interactivo', 'Fotos dermatoscópicas', 'Comparativos pre/post'], price: '329', status: 'available' },
  { id: 'gynecology', name: 'Ginecología', category: 'Ginecología', icon: Activity, iconBg: 'bg-purple-50', iconColor: 'text-purple-600', description: 'Calendario obstétrico, ultrasonidos y plan prenatal.', features: ['Edad gestacional automática', 'Papanicolaou histórico', 'Plan prenatal estándar'], price: '329', status: 'available' },
  { id: 'nutrition', name: 'Nutrición', category: 'Nutrición', icon: Apple, iconBg: 'bg-green-50', iconColor: 'text-green-600', description: 'Antropometría, plan de alimentación y comparativos.', features: ['Pliegues y perímetros', 'Plan con porciones', 'Recordatorios de pesaje'], price: '229', status: 'available' },
  { id: 'aesthetic-medicine', name: 'Medicina Estética', category: 'Estética', icon: Sparkles, iconBg: 'bg-fuchsia-50', iconColor: 'text-fuchsia-600', description: 'Antes/después, tracking de toxina y rellenos por lote.', features: ['Fotos estandarizadas', 'Toxina: zonas, unidades, lote', 'Sesiones de láser'], price: '399', status: 'available' },
];
